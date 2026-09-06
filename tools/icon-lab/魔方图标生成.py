# -*- coding: utf-8 -*-
"""MotionCube 魔方图标生成器（独创：斜摆三阶，F 层多转 / B 层少转，WinUI 单蓝色系明度阶梯）。

两种造型风格（style）：
  "cube"   —— 完整 26 块三阶（贴纸跟随块面）
  "plates" —— 三板式抽象：F 板（浅色塑 + 3×3 强调贴纸）、S 板（中间调 + 细网格线）、
              B 板（近深色塑厚板无纹理）；全部边缘圆角，无锐角/直角。

与 tools/icon-lab/index.html 预览器共用同一套视角/建模约定——
  y 向上，F 面 = +z，R 面 = +x；
  azim 0° 正对 F 面，正值向 R 面转；elev 为正俯视；
  相机 = dist * (cos(e)sin(a), sin(e), cos(e)cos(a))，垂直 fov；
  F 正 = 从前面看顺时针；B 正 = 从后面看顺时针。

用法：
  python 魔方图标生成.py                                   # 用下方 PARAMS 默认值
  python 魔方图标生成.py '{"style":"plates","fAngle":24.5}' # 预览器复制的参数 JSON 直接贴
  python 魔方图标生成.py '<json>' --dir D:\\out              # 指定输出目录

输出（到 --dir）：
  icon.png            主图标 1024 → 交给 `npx tauri icon` 出全套
  uninstall-icon.png  卸载图标 1024 预览
  uninstaller.ico     卸载图标 .ico → 覆盖 src-tauri/icons/uninstaller.ico
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ============ 参数头（预览器「复制参数 JSON」直接贴这里或用命令行传参） ============
PARAMS = {
    "style": "cube",             # "cube" | "plates"
    "elev": 33.6,              # 俯仰角 °
    "azim": 49.5,              # 方位角 °（0 正对 F，正为向 R）
    "dist": 11.5,              # 视距（只影响透视强弱，构图自动居中裁切）
    "fov": 28,                 # 垂直视场角 °
    "fAngle": 14.0,            # F 板/层转角 °（正 = 从前面看顺时针）
    "fTwist": 10.0,            # F 层每块自身额外拧角 °（风格化，仅 cube 样式）
    "bAngle": 5.0,             # B 板/层转角 °（正 = 从后面看顺时针）
    "palette": "lightPale",            # 主图标配色
    "uninstallPalette": "uninstall",  # 卸载图标配色（深塑体 + 红色贴纸）
    "plate": "auto",           # 底板：auto=跟随配色 / none=透明
    "fit": 0.86,               # 投影占画布比例
    "resolution": 1024,
    "ss": 4,                   # 超采样倍数（抗锯齿）
    "shadow": False,           # 柔和投影（浅塑体小尺寸救星，可选）
    "paletteOverride": {},     # 覆盖任意色值，如 {"F.sticker":"#0a84ff"}
    "uninstallOverride": {},
}

# ============ 调色板 ============
# 完整魔方风格（单蓝色系明度阶梯）
PALETTES = {
    "gray":      dict(F="#f0f0f0", U="#ffffff", R="#d2d2d2", L="#bfbfbf", D="#9a9a9a", B="#8a8a8a",
                      body="#4a4f55", plate="#f3f3f3"),
    "lightDeep": dict(F="#0f83d9", U="#59aeea", R="#0b6bb2", L="#0a5c99", D="#084a7d", B="#073c66",
                      body="#16293a", plate="#f3f3f3"),
    "lightPale": dict(F="#0f83d9", U="#59aeea", R="#0b6bb2", L="#0a5c99", D="#084a7d", B="#073c66",
                      body="#e7eef4", plate="#f3f3f3"),
    "dark":      dict(F="#3da0e4", U="#7cc4f2", R="#2b7fbe", L="#226a9f", D="#1a5680", B="#15486b",
                      body="#0b1622", plate="#202020"),
    "uninstall": dict(F="#c42b1c", U="#5f7f9b", R="#33506a", L="#2c4860", D="#243c50", B="#1d3345",
                      body="#101820", plate="#272727"),
}
# 三板式风格：F 浅塑强调贴纸 / S 中间调细线 / B 近深塑厚板，填空递进
PALETTES_PLATES = {
    "platesLight": dict(
        **{"F.face": "#eef3f8", "F.bevel": "#e6edf4", "F.side": "#c8d7e6", "F.sticker": "#0f83d9"},
        **{"S.face": "#b7cfe4", "S.bevel": "#aec7dd", "S.side": "#86a8c6", "S.line": "#35597c"},
        **{"B.face": "#22394e", "B.bevel": "#1e3346", "B.side": "#142433"},
        plate="#f3f3f3"),
    "platesUninstall": dict(
        **{"F.face": "#2a3642", "F.bevel": "#26313d", "F.side": "#1a232c", "F.sticker": "#c42b1c"},
        **{"S.face": "#46586a", "S.bevel": "#405061", "S.side": "#2f3f4d", "S.line": "#a8c0d4"},
        **{"B.face": "#161d24", "B.bevel": "#131a21", "B.side": "#0c1116"},
        plate="#272727"),
}

# ============ 建模常量（与预览器一致） ============
STEP = 1.06
STICKER, CORNER, E = 0.86, 0.13, 0.502
AX = {"F": ("z", 1), "B": ("z", -1), "R": ("x", 1), "L": ("x", -1), "U": ("y", 1), "D": ("y", -1)}
# 三板式：板边长 / 厚 / 圆角 / 倒角 / 板间距
PA, PT, PR, PB, PZ = 3.0, 0.72, 0.34, 0.05, 0.86
PM, PGAP, PCORN = 0.04, 0.09, 0.07   # F 板贴纸区边距 / 贴纸缝 / 贴纸圆角（贴纸观感：几乎铺满）
SLINE = 0.08                          # S 板细线宽


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def face_basis(kind):
    ax, s = AX[kind]
    n = np.eye(3)["xyz".index(ax)] * float(s)
    if ax == "z":
        u, v = np.array([float(s), 0, 0]), np.array([0, 1.0, 0])
    elif ax == "x":
        u, v = np.array([0, 0, -float(s)]), np.array([0, 1.0, 0])
    else:
        u, v = np.array([1.0, 0, 0]), np.array([0, 0, -float(s)])
    return n, u, v


def rounded_rect_poly(a, r, seg=6):
    h = a / 2
    pts = []
    # 逆时针：左下(180→270) → 右下(270→360) → 右上(0→90) → 左上(90→180)
    for cx, cy, a0 in [(-h + r, -h + r, 180), (h - r, -h + r, 270),
                       (h - r, h - r, 0), (-h + r, h - r, 90)]:
        for i in range(seg + 1):
            t = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return np.array(pts)


def rot_z(deg):
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def orient(verts, center):
    """绕序整理成从外看向逆时针，返回 (verts, outward normal)。"""
    n = np.cross(verts[1] - verts[0], verts[2] - verts[0])
    n /= np.linalg.norm(n)
    if n @ (verts.mean(axis=0) - center) < 0:
        verts = verts[::-1]
        n = -n
    return verts, n


# ---------- 完整魔方 ----------
LSTEP = 1.0    # F/B 层内间距：消除间隙（1.06=原缝，1.0=并缝）
def build_cube(f_angle, b_angle, f_twist=0.0):
    """(colorkey, verts3d, normal)：贴纸颜色跟随块面，随层一起转。
    F 层 = 整层刚体转 f_angle + 每块自身拧 f_twist（风格化）；B 层纯刚体转。"""
    polys, rr = [], rounded_rect_poly(STICKER, CORNER)
    for ix in (-1, 0, 1):
        for iy in (-1, 0, 1):
            for iz in (-1, 0, 1):
                if not (ix or iy or iz):
                    continue
                ang = -f_angle if iz == 1 else (b_angle if iz == -1 else 0.0)
                Rm = rot_z(ang)                                   # 整层刚体旋转
                Rt = rot_z(-f_twist) if iz == 1 else np.eye(3)    # 块内偏转（仅 F 层）
                s = LSTEP if iz else STEP                          # F/B 层内并缝，中层保持原缝
                pos = np.array([ix * s, iy * s, iz * STEP], float)
                def xf(local):
                    return (pos + local @ Rt.T) @ Rm.T
                for kind in AX:
                    n, u, v = face_basis(kind)
                    quad = xf(np.stack([n * 0.5 + su * u * 0.5 + sv * v * 0.5
                                        for su, sv in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]))
                    polys.append(("body", quad, Rm @ (Rt @ n)))
                    if {"x": ix, "y": iy, "z": iz}[AX[kind][0]] != AX[kind][1]:
                        continue
                    local = np.stack([p[0] * u + p[1] * v + n * E for p in rr])
                    polys.append((kind, xf(local), Rm @ (Rt @ n)))
    return polys


# ---------- 三板式 ----------
def _plate(base, ang, zc):
    """一块沿 z 挤出的圆角矩形棱柱（前后带倒角 → 无锐角）。返回 polys 列表。"""
    Rm = rot_z(ang)
    R2 = Rm[:2, :2]
    def tf(xy, z):  # 局部 → 世界（z 可为标量或逐点列表）
        p = np.asarray(xy, float) @ R2.T
        zz = np.broadcast_to(np.asarray(z, float) + zc, (len(p),))
        return np.concatenate([p, zz[:, None]], axis=1)
    loop0 = rounded_rect_poly(PA, PR, seg=8)            # 外轮廓（最宽处）
    loop1 = rounded_rect_poly(PA - 2 * PB, PR - PB, seg=8)  # 正面（缩进 b）
    n = len(loop0)
    polys = []
    center = np.array([0.0, 0.0, zc])
    # 正/背面
    for ck, zz in ((f"{base}.face", PT / 2), (f"{base}.face", -PT / 2)):
        v, nn = orient(tf(loop1, zz), center)
        polys.append((ck, v, nn))
    for i in range(n):
        j = (i + 1) % n
        # 前倒角带 / 侧带 / 后倒角带
        v, nn = orient(tf([loop0[i], loop0[j], loop1[j], loop1[i]], [PT / 2 - PB] * 2 + [PT / 2] * 2), center)
        polys.append((f"{base}.bevel", v, nn))
        v, nn = orient(tf([loop0[i], loop0[j], loop0[j], loop0[i]],
                          [PT / 2 - PB, PT / 2 - PB, -PT / 2 + PB, -PT / 2 + PB]), center)
        polys.append((f"{base}.side", v, nn))
        v, nn = orient(tf([loop1[i], loop1[j], loop0[j], loop0[i]],
                          [-PT / 2] * 2 + [-PT / 2 + PB] * 2), center)
        polys.append((f"{base}.side", v, nn))
    return polys


def build_plates(f_angle, b_angle):
    polys = []
    polys += _plate("B", b_angle, -PZ)          # 近深塑厚板，微小转角
    polys += _plate("S", 0.0, 0.0)              # 中间调 + 细网格线
    polys += _plate("F", -f_angle, PZ)          # 浅塑 + 强调贴纸，主转角
    # F 板 3×3 贴纸
    zspan = PA - 2 * (PB + PM)
    s = (zspan - 2 * PGAP) / 3
    d = (s + PGAP) / 2          # S 板细线中心距（与 F 板缝对齐）
    rr = rounded_rect_poly(s, PCORN, seg=6)
    Rm = rot_z(-f_angle)
    zz = PZ + PT / 2 + 0.004
    for gx in (-1, 0, 1):
        for gy in (-1, 0, 1):
            c = np.array([gx, gy], float) * (s + PGAP)
            xy = (rr + c) @ Rm[:2, :2].T
            v = np.concatenate([xy, np.full((len(rr), 1), zz)], axis=1)
            v, nn = orient(v, np.array([0.0, 0.0, PZ]))
            polys.append(("F.sticker", v, nn))
    # S 板细网格线（位置与 F 板缝对齐，宽度细得多、端头全圆）
    zz = PT / 2 + 0.004
    line = rounded_rect_poly(zspan * 0.98, SLINE, seg=4)  # 胶囊形
    for k in (-1, 1):
        for vertical in (True, False):
            pts = line if vertical else np.stack([line[:, 1], line[:, 0]], axis=1)
            c = np.array([k * d if vertical else 0, 0 if vertical else k * d])
            v = np.concatenate([pts + c, np.full((len(pts), 1), zz)], axis=1)
            v, nn = orient(v, np.array([0.0, 0.0, 0.0]))
            polys.append(("S.line", v, nn))
    return polys


# ---------- 投影与光栅 ----------
def project(polys, p, W):
    e, a = math.radians(p["elev"]), math.radians(p["azim"])
    C = p["dist"] * np.array([math.cos(e) * math.sin(a), math.sin(e), math.cos(e) * math.cos(a)])
    f = -C / np.linalg.norm(C)
    r = np.cross(f, [0.0, 1.0, 0.0]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    focal = (W / 2.0) / math.tan(math.radians(p["fov"]) / 2)

    tris, allx, ally = [], [], []
    for ck, verts, n in polys:
        cen = verts.mean(axis=0)
        if (n @ (C - cen)) <= 0:
            continue
        d = verts - C
        zv = d @ f
        if zv.min() <= 0.05:
            continue
        sx, sy, w = (d @ r) / zv * focal, (d @ u) / zv * focal, 1.0 / zv
        allx.append(sx); ally.append(sy)
        for i in range(1, len(verts) - 1):
            tris.append((np.array([sx[0], sy[0], w[0]]), np.array([sx[i], sy[i], w[i]]),
                         np.array([sx[i + 1], sy[i + 1], w[i + 1]]), ck))
    allx, ally = np.concatenate(allx), np.concatenate(ally)
    cx, cy = (allx.min() + allx.max()) / 2, (ally.min() + ally.max()) / 2
    k = (p["fit"] * W) / max(allx.max() - allx.min(), ally.max() - ally.min())
    return [(np.array([(v0[0] - cx) * k, (v0[1] - cy) * k, v0[2]]),
             np.array([(v1[0] - cx) * k, (v1[1] - cy) * k, v1[2]]),
             np.array([(v2[0] - cx) * k, (v2[1] - cy) * k, v2[2]]), ck)
            for v0, v1, v2, ck in tris]


def render(pal, p, silhouette=False):
    W = H = p["resolution"] * p["ss"]
    buf = np.zeros((H, W, 4), np.uint8)
    zbuf = np.full((H, W), np.inf, np.float32)
    keys = [k for k in pal if k != "plate"]
    colors = {k: (0x1b, 0x2b, 0x3b, 255) if silhouette else (*hexrgb(pal[k]), 255) for k in keys}
    cx0, cy0 = W / 2.0, H / 2.0

    build = (build_plates(p["fAngle"], p["bAngle"]) if p["style"] == "plates"
             else build_cube(p["fAngle"], p["bAngle"], p.get("fTwist", 0.0)))
    for v0, v1, v2, ck in project(build, p, W):
        col = colors[ck]
        area = (v1[0] - v0[0]) * (v2[1] - v0[1]) - (v2[0] - v0[0]) * (v1[1] - v0[1])
        if abs(area) < 1e-9:
            continue
        if area < 0:
            v1, v2, area = v2, v1, -area
        x0 = max(int(min(v0[0], v1[0], v2[0]) + cx0), 0)
        x1 = min(int(max(v0[0], v1[0], v2[0]) + cx0) + 1, W)
        y0 = max(int(cy0 - max(v0[1], v1[1], v2[1])), 0)
        y1 = min(int(cy0 - min(v0[1], v1[1], v2[1])) + 1, H)
        if x0 >= x1 or y0 >= y1:
            continue
        px, py = np.meshgrid(np.arange(x0, x1, dtype=np.float32) + 0.5 - cx0,
                             cy0 - np.arange(y0, y1, dtype=np.float32) - 0.5)
        l0 = ((v1[0] - px) * (v2[1] - v1[1]) - (v1[1] - py) * (v2[0] - v1[0])) / area
        l1 = ((v2[0] - px) * (v0[1] - v2[1]) - (v2[1] - py) * (v0[0] - v2[0])) / area
        l2 = 1.0 - l0 - l1
        mask = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        if not mask.any():
            continue
        iw = l0 * v0[2] + l1 * v1[2] + l2 * v2[2]
        z = np.where(iw > 0, 1.0 / np.maximum(iw, 1e-9), np.inf)
        sub = zbuf[y0:y1, x0:x1]
        upd = mask & (z < sub)
        sub[upd] = z[upd]
        buf[y0:y1, x0:x1][upd] = col

    return Image.fromarray(buf, "RGBA").resize((p["resolution"],) * 2, Image.BOX)


def make_icon(pal, p):
    """图形 + 可选柔和投影 + 可选圆角底板 → 最终图标。"""
    W = p["resolution"]
    cube = render(pal, p)
    if p.get("shadow"):
        sil = render(pal, p, silhouette=True).filter(ImageFilter.GaussianBlur(W * 0.02))
        r, g, b, a = sil.split()
        sil = Image.merge("RGBA", (r, g, b, a.point(lambda v: int(v * 0.30))))
        out = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        out.alpha_composite(sil, (0, int(W * 0.012)))
        out.alpha_composite(cube)
        cube = out
    if p["plate"] != "none":
        bg = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        ImageDraw.Draw(bg).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.22,
                                             fill=(*hexrgb(pal["plate"]), 255))
        bg.alpha_composite(cube)
        cube = bg
    return cube


def resolve(name, override):
    table = dict(PALETTES, **PALETTES_PLATES)
    return dict(table[name], **override)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("params", nargs="?", default="{}", help="覆盖 PARAMS 的 JSON（预览器复制的参数直接贴）")
    ap.add_argument("--dir", default=".", help="输出目录")
    a = ap.parse_args()
    p = dict(PARAMS); p.update(json.loads(a.params or "{}"))
    os.makedirs(a.dir, exist_ok=True)

    make_icon(resolve(p["palette"], p.get("paletteOverride", {})), p).save(os.path.join(a.dir, "icon.png"))
    up = dict(p, palette=p["uninstallPalette"])
    un = make_icon(resolve(up["palette"], p.get("uninstallOverride", {})), up)
    un.save(os.path.join(a.dir, "uninstall-icon.png"))
    un.resize((256, 256), Image.LANCZOS).save(
        os.path.join(a.dir, "uninstaller.ico"),
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("已生成:", ", ".join(os.path.join(a.dir, f) for f in
                              ("icon.png", "uninstall-icon.png", "uninstaller.ico")))


if __name__ == "__main__":
    main()
