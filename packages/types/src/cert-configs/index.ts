import type { CertConfig } from "../cert-config.js";
import { comptiaSecurityPlus } from "./comptia-security-plus.js";

// Registry of all cert configs, keyed by courses.slug.
// Add a new entry here when a new certification course is created.
export const certConfigs: Record<string, CertConfig> = {
  "comptia-security-plus": comptiaSecurityPlus,
};

export { comptiaSecurityPlus };
