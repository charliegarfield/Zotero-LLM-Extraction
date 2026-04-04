/**
 * LLM Metadata Extractor — Main entry point
 *
 * This is the bundled entry point loaded by bootstrap.js.
 * It exports the addon instance and hooks for the bootstrap lifecycle.
 */

import { addon } from "./addon";
import { hooks } from "./hooks";

// Attach hooks to the addon for bootstrap.js to access
(addon as any).hooks = hooks;

export default addon;
