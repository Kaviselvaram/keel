/**
 * Ignore-rule matching (Doc 20 §5: diff owns the matcher; rules arrive as
 * validated opaque strings from config via the caller).
 *
 * Frozen v1 rule language: a rule is matched against the divergence's
 * formatted path (e.g. `stream:stdout/json:$.items[3].price`); `*` matches
 * any run of characters, everything else is literal. Examples:
 *   `stream:stdout/json:$.meta.*`   — ignore everything under $.meta
 *   `fs-effect:logs/*`              — ignore all fs effects under logs/
 */

export type CompiledIgnoreRule = (formattedPath: string) => boolean;

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileIgnoreRules(rules: readonly string[]): CompiledIgnoreRule {
  if (rules.length === 0) return () => false;
  const compiled = rules.map(
    (rule) => new RegExp(`^${rule.split('*').map(escapeRegex).join('.*')}$`),
  );
  return (formattedPath) => compiled.some((pattern) => pattern.test(formattedPath));
}
