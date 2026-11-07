import { execSync } from "node:child_process";

/** Reset demo accounts before the suite so every run starts from the same state. */
export default function globalSetup() {
  execSync("npm run seed", { stdio: "inherit" });
}
