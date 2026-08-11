/** 让 TS 能导入 .vue 文件（单文件组件由 @vitejs/plugin-vue 编译）。 */
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, never>, Record<string, never>, any>;
  export default component;
}
