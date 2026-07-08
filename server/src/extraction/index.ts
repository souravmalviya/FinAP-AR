import { env } from "../config/env.js";
import { Extractor } from "./extractor.js";
import { mockExtractor } from "./mockExtractor.js";
import { claudeExtractor } from "./claudeExtractor.js";
import { openRouterExtractor } from "./openRouterExtractor.js";

// Engine selection happens in exactly one place. Priority:
//   1. Anthropic key  -> Claude direct
//   2. OpenRouter key -> any model via OpenRouter (OPENROUTER_MODEL picks it)
//   3. neither        -> free offline mock
export function getExtractor(): Extractor {
  if (env.ANTHROPIC_API_KEY) return claudeExtractor;
  if (env.OPENROUTER_API_KEY) return openRouterExtractor;
  return mockExtractor;
}
