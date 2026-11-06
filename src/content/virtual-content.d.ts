declare module "virtual:crownguard-content/shared" {
  import type { SharedContentJson } from "./chunks";
  const data: SharedContentJson;
  export default data;
}

declare module "virtual:crownguard-content/report" {
  import type { ReportContentJson } from "./chunks";
  const data: ReportContentJson;
  export default data;
}

declare module "virtual:crownguard-content/platforms" {
  import type { PlatformContentJson } from "./chunks";
  const loaders: Record<string, () => Promise<{ default: PlatformContentJson }>>;
  export default loaders;
}
