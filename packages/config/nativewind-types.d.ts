// nativewind@4.2.6 ships an empty declaration file for its Tailwind preset entrypoint.
declare module "nativewind/preset" {
  import type { Config } from "tailwindcss";

  const preset: Partial<Config>;
  export default preset;
}
