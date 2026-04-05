import { LexPattern } from '../types';

/**
 * Full Lex/Flex Interpreter
 *
 * Supports the three standard lex sections:
 *   1. Definitions  (%{ C code %}, named definitions like  digit  [0-9])
 *   2. Rules        (pattern  { action })
 *   3. User Code    (C main function — informational only)
 *
 * Pattern support:
 *   - Character classes  [a-zA-Z], [^abc], [0-9]
 *   - Quantifiers  +, *, ?, {n}, {n,m}
 *   - Alternation  |
 *   - Grouping  ()
 *   - Dot .  (match any char except \n)
 *   - Anchors  ^ $
 *   - Escape sequences  \n \t \r \s \d \w etc.
 *   - Quoted literal strings  "..."
 *   - Named definition references  {name}
 *   - Concatenation of sub-patterns like  {letter}({letter}|{digit})*
 *
 * Action support:
 *   - printf("FORMAT", args)  with %s (yytext), %d (yyleng), %c, \\n, \\t
 *   - ECHO
 *   - /* comment * / style skip
 *   - Empty action  (skip)
 *   - return TOKEN
 *   - Multi-line actions with {}
 *   - Counter variables (word_count++, etc.)
 *   - fprintf, puts, putchar
 */

export interface LexRule {
  pattern: RegExp;
  patternSource: string;
  action: string;
  line: number;
}

export interface LexDefinition {
  name: string;
  pattern: string;
}

export interface LexState {
  yytext: string;
  yyleng: number;
  yylineno: number;
}

export class LexInterpreter {
  private rules: LexRule[] = [];
  private definitions: LexDefinition[] = [];
  private patterns: LexPattern[] = [];
  private declarations: string = '';
  private userCode: string = '';
  private inputBuffer: string = '';
  private inputIndex: number = 0;
  private state: LexState;
  private output: string[] = [];
  private error: string | null = null;
  private isRunning: boolean = false;

  // Simulated C variables declared in %{ %} or rule actions
  private variables: Map<string, number> = new Map();

  constructor() {
    this.state = { yytext: '', yyleng: 0, yylineno: 1 };
  }

  /* ════════════════════════════════════════════════════
     PARSING — turns .l source into rules
     ════════════════════════════════════════════════════ */

  parse(content: string): { success: boolean; error?: string } {
    this.error = null;
    this.rules = [];
    this.definitions = [];
    this.patterns = [];
    this.declarations = '';
    this.userCode = '';
    this.variables = new Map();

    try {
      const sections = this.splitSections(content);

      // Section 1: definitions
      this.parseDefinitions(sections.definitions);

      // Section 2: rules
      const rulesResult = this.parseRules(sections.rules);
      if (!rulesResult.success) {
        return rulesResult;
      }

      // Section 3: user code (informational)
      this.userCode = sections.userCode;

      // Extract declared variables from %{ %} block
      this.extractVariables(this.declarations);

      if (this.rules.length === 0) {
        return { success: false, error: 'No lexical rules found between the %% markers.' };
      }

      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  }

  /**
   * Split source into the three lex sections separated by %%
   */
  private splitSections(content: string): {
    definitions: string;
    rules: string;
    userCode: string;
  } {
    // Find %% delimiters (must be on their own line, possibly with whitespace)
    const lines = content.split('\n');
    const sectionBreaks: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '%%') {
        sectionBreaks.push(i);
      }
    }

    if (sectionBreaks.length === 0) {
      // No %% found — treat entire content as rules section
      return { definitions: '', rules: content, userCode: '' };
    }

    if (sectionBreaks.length === 1) {
      // One %% — definitions before, rules after
      return {
        definitions: lines.slice(0, sectionBreaks[0]).join('\n'),
        rules: lines.slice(sectionBreaks[0] + 1).join('\n'),
        userCode: '',
      };
    }

    // Two or more %% — standard: definitions, rules, user code
    return {
      definitions: lines.slice(0, sectionBreaks[0]).join('\n'),
      rules: lines.slice(sectionBreaks[0] + 1, sectionBreaks[1]).join('\n'),
      userCode: lines.slice(sectionBreaks[1] + 1).join('\n'),
    };
  }

  /**
   * Parse the definitions section:  %{ C code %}, named patterns, %option lines
   */
  private parseDefinitions(section: string): void {
    const lines = section.split('\n');
    let inCBlock = false;
    let cBlock = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // C code block
      if (trimmed.startsWith('%{')) {
        inCBlock = true;
        // handle inline: %{ #include <stdio.h>
        const rest = trimmed.slice(2).trim();
        if (rest.endsWith('%}')) {
          cBlock += rest.slice(0, -2) + '\n';
          inCBlock = false;
        } else if (rest) {
          cBlock += rest + '\n';
        }
        continue;
      }
      if (inCBlock) {
        if (trimmed.startsWith('%}') || trimmed.endsWith('%}')) {
          inCBlock = false;
          const before = trimmed.replace('%}', '').trim();
          if (before) cBlock += before + '\n';
          continue;
        }
        cBlock += line + '\n';
        continue;
      }

      // Skip %option, comments, blank lines
      if (trimmed.startsWith('%option') || trimmed === '' || trimmed.startsWith('//')) {
        continue;
      }

      // Multi-line comment
      if (trimmed.startsWith('/*')) {
        // Skip until closing */
        while (i < lines.length && !lines[i].includes('*/')) i++;
        continue;
      }

      // Named definition:  name   pattern
      // e.g.  digit   [0-9]
      //       letter  [a-zA-Z]
      //       id      {letter}({letter}|{digit})*
      const defMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/);
      if (defMatch) {
        this.definitions.push({
          name: defMatch[1],
          pattern: defMatch[2].trim(),
        });
      }
    }

    this.declarations = cBlock;
  }

  /**
   * Parse the rules section:  pattern  { action }
   */
  private parseRules(section: string): { success: boolean; error?: string } {
    const lines = section.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip blank lines
      if (trimmed === '') {
        i++;
        continue;
      }

      // Skip comments
      if (trimmed.startsWith('//')) {
        i++;
        continue;
      }
      if (trimmed.startsWith('/*')) {
        while (i < lines.length && !lines[i].includes('*/')) i++;
        i++;
        continue;
      }

      // Try to extract a pattern and action from this line
      const parsed = this.extractPatternAction(lines, i);
      if (parsed) {
        const { pattern, action, endLine } = parsed;
        const result = this.addRule(pattern, action, i + 1);
        if (!result.success) {
          return { success: false, error: `Line ${i + 1}: ${result.error}` };
        }
        i = endLine + 1;
      } else {
        i++;
      }
    }

    return { success: true };
  }

  /**
   * Extract pattern and action from a rule line, handling multi-line actions.
   *
   * Lex rules can look like:
   *   [0-9]+      { printf("NUM: %s\n", yytext); }
   *   "+"         { printf("PLUS\n"); }
   *   {digit}+    { printf("...\n"); }
   *   .           { printf("UNKNOWN\n"); }
   *   [ \t\n]     { /* skip * / }
   *   {ws}        ;
   */
  private extractPatternAction(
    lines: string[],
    startLine: number
  ): { pattern: string; action: string; endLine: number } | null {
    const line = lines[startLine];
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Find where the pattern ends and action begins.
    // The action starts at the first '{' that is NOT part of a definition {name}
    // or quantifier {n,m}, and not inside [...] or "..."
    // OR the action is just ';' (empty action)

    let patternEnd = -1;
    let actionStart = -1;
    let inBracket = false;
    let inQuote = false;
    let escaped = false;

    for (let j = 0; j < trimmed.length; j++) {
      const ch = trimmed[j];

      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }

      if (!inQuote && ch === '[') { inBracket = true; continue; }
      if (inBracket && ch === ']') { inBracket = false; continue; }
      if (inBracket) continue;

      if (ch === '"') { inQuote = !inQuote; continue; }
      if (inQuote) continue;

      // Whitespace that could separate pattern from action
      if (/[\t ]/.test(ch) && j > 0) {
        // Look ahead past whitespace for the action
        let k = j;
        while (k < trimmed.length && /[\t ]/.test(trimmed[k])) k++;
        if (k >= trimmed.length) break; // trailing whitespace — no action

        const ahead = trimmed[k];

        if (ahead === '{') {
          // Check if this { is a definition reference {name} or quantifier {n,m}
          // by looking at what's between { and }
          const closeBrace = trimmed.indexOf('}', k);
          if (closeBrace !== -1) {
            const inside = trimmed.slice(k + 1, closeBrace);
            // If inside is a valid definition name or quantifier, it's still pattern
            const isDefRef = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(inside);
            const isQuantifier = /^\d+(,\d*)?$/.test(inside);
            if (isDefRef || isQuantifier) {
              // This is part of the pattern, not an action — skip past it
              continue;
            }
          }
          // This { starts the action
          patternEnd = j;
          actionStart = k;
          break;
        }

        if (ahead === ';' || ahead === '|') {
          patternEnd = j;
          actionStart = k;
          break;
        }

        // else it's a space inside the pattern (shouldn't happen in standard lex normally)
        // keep scanning
        continue;
      }

      // '{' immediately after pattern with no space
      if (ch === '{' && j > 0) {
        // Check if this is definition ref or quantifier
        const closeBrace = trimmed.indexOf('}', j);
        if (closeBrace !== -1) {
          const inside = trimmed.slice(j + 1, closeBrace);
          const isDefRef = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(inside);
          const isQuantifier = /^\d+(,\d*)?$/.test(inside);
          if (isDefRef || isQuantifier) {
            j = closeBrace; // skip past — part of pattern
            continue;
          }
        }
        // Action brace
        patternEnd = j;
        actionStart = j;
        break;
      }
    }

    if (patternEnd === -1 || actionStart === -1) return null;

    const pattern = trimmed.slice(0, patternEnd).trim();
    if (!pattern) return null;

    const actionPart = trimmed.slice(actionStart).trim();

    // Handle ';' (empty action = skip)
    if (actionPart === ';') {
      return { pattern, action: '/* skip */', endLine: startLine };
    }

    // Handle '|' (same action as next rule)
    if (actionPart === '|') {
      // Find the next rule's action
      const nextParsed = this.extractPatternAction(lines, startLine + 1);
      if (nextParsed) {
        return { pattern, action: nextParsed.action, endLine: startLine };
      }
      return null;
    }

    // Extract action with brace matching (possibly multi-line)
    if (actionPart.startsWith('{')) {
      let braceDepth = 0;
      const actionLines: string[] = [];

      for (let lineI = startLine; lineI < lines.length; lineI++) {
        const ln = lineI === startLine ? trimmed.slice(actionStart) : lines[lineI];
        actionLines.push(ln);

        for (let c = 0; c < ln.length; c++) {
          if (ln[c] === '\\') { c++; continue; } // skip escapes
          if (ln[c] === '"') {
            // skip string literal
            c++;
            while (c < ln.length && ln[c] !== '"') {
              if (ln[c] === '\\') c++;
              c++;
            }
            continue;
          }
          if (ln[c] === '{') braceDepth++;
          if (ln[c] === '}') {
            braceDepth--;
            if (braceDepth === 0) {
              const fullAction = actionLines.join('\n');
              const openIdx = fullAction.indexOf('{');
              const closeIdx = fullAction.lastIndexOf('}');
              const body = fullAction.slice(openIdx + 1, closeIdx).trim();
              return { pattern, action: body, endLine: lineI };
            }
          }
        }
      }

      // Never closed — take what we have
      const fullAction = actionLines.join('\n');
      const openIdx = fullAction.indexOf('{');
      const body = openIdx !== -1 ? fullAction.slice(openIdx + 1).trim() : fullAction.trim();
      return { pattern, action: body, endLine: lines.length - 1 };
    }

    return null;
  }

  /**
   * Add a compiled rule
   */
  private addRule(
    rawPattern: string,
    action: string,
    line: number
  ): { success: boolean; error?: string } {
    if (!rawPattern) return { success: false, error: 'Empty pattern' };

    try {
      const regexSource = this.convertLexPattern(rawPattern);
      // Use sticky flag for anchored matching at lastIndex
      const regex = new RegExp(regexSource, 'y');

      this.rules.push({
        pattern: regex,
        patternSource: rawPattern,
        action: action.trim(),
        line,
      });

      this.patterns.push({
        pattern: rawPattern,
        action: action.trim(),
        line,
      });

      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Invalid pattern "${rawPattern}": ${msg}` };
    }
  }

  /* ════════════════════════════════════════════════════
     PATTERN CONVERSION — Lex pattern → JavaScript RegExp
     ════════════════════════════════════════════════════ */

  /**
   * Convert a lex pattern to a JavaScript regex string.
   *
   * Handles:
   *  - "literal"  → escaped literal
   *  - [charclass]  → passed through (Lex and JS use same syntax mostly)
   *  - {name}  → expand definition
   *  - .  → [^\n]
   *  - Quantifiers +, *, ?
   *  - Grouping ()
   *  - Alternation |
   *  - Concatenation of sub-expressions
   *  - Lex-specific escapes (\n, \t, etc.)
   *  - ^ and $ anchors
   */
  private convertLexPattern(pattern: string): string {
    let result = '';
    let i = 0;

    while (i < pattern.length) {
      const ch = pattern[i];

      // Escape sequence
      if (ch === '\\' && i + 1 < pattern.length) {
        const next = pattern[i + 1];
        result += this.convertEscape(next);
        i += 2;
        continue;
      }

      // Quoted literal string
      if (ch === '"') {
        const end = pattern.indexOf('"', i + 1);
        if (end === -1) {
          result += escapeRegex(pattern.slice(i + 1));
          i = pattern.length;
        } else {
          result += escapeRegex(pattern.slice(i + 1, end));
          i = end + 1;
        }
        continue;
      }

      // Character class [...]
      if (ch === '[') {
        const end = this.findCharClassEnd(pattern, i);
        result += this.convertCharClass(pattern.slice(i, end + 1));
        i = end + 1;
        continue;
      }

      // Definition reference {name} or quantifier {n} {n,m}
      if (ch === '{') {
        const closeBrace = pattern.indexOf('}', i);
        if (closeBrace === -1) {
          result += '\\{';
          i++;
          continue;
        }
        const inside = pattern.slice(i + 1, closeBrace);

        // Quantifier: {3}, {1,5}, {3,}
        if (/^\d+(,\d*)?$/.test(inside)) {
          result += `{${inside}}`;
          i = closeBrace + 1;
          continue;
        }

        // Definition reference
        const def = this.definitions.find(d => d.name === inside);
        if (def) {
          const expanded = this.convertLexPattern(def.pattern);
          result += `(?:${expanded})`;
        } else {
          // Unknown definition — treat as literal
          result += escapeRegex(`{${inside}}`);
        }
        i = closeBrace + 1;
        continue;
      }

      // Dot — in Lex means "any character except newline"
      if (ch === '.') {
        result += '[^\\n]';
        i++;
        continue;
      }

      // Pass through regex meta characters
      if ('()|+*?^$'.includes(ch)) {
        result += ch;
        i++;
        continue;
      }

      // Regular character
      if ('/'.includes(ch)) {
        result += '\\' + ch;
      } else {
        result += ch;
      }
      i++;
    }

    return result;
  }

  /**
   * Find the closing ] for a character class, handling escapes
   */
  private findCharClassEnd(pattern: string, openBracket: number): number {
    let i = openBracket + 1;
    // ] right after [ or [^ is literal
    if (i < pattern.length && pattern[i] === '^') i++;
    if (i < pattern.length && pattern[i] === ']') i++;

    while (i < pattern.length) {
      if (pattern[i] === '\\' && i + 1 < pattern.length) {
        i += 2;
        continue;
      }
      if (pattern[i] === ']') return i;
      i++;
    }
    return pattern.length - 1;
  }

  /**
   * Convert a Lex character class to JS regex character class
   */
  private convertCharClass(charClass: string): string {
    let result = '[';
    const inner = charClass.slice(1, -1); // strip [ and ]

    for (let j = 0; j < inner.length; j++) {
      if (inner[j] === '\\' && j + 1 < inner.length) {
        result += this.convertEscape(inner[j + 1]);
        j++;
      } else {
        result += inner[j];
      }
    }

    result += ']';
    return result;
  }

  /**
   * Convert a Lex escape character to JS regex
   */
  private convertEscape(ch: string): string {
    switch (ch) {
      case 'n': return '\\n';
      case 't': return '\\t';
      case 'r': return '\\r';
      case 'f': return '\\f';
      case 'v': return '\\v';
      case 'a': return '\\x07'; // bell
      case 'b': return '\\b';
      case 'd': return '\\d';
      case 'D': return '\\D';
      case 'w': return '\\w';
      case 'W': return '\\W';
      case 's': return '\\s';
      case 'S': return '\\S';
      case '0': return '\\0';
      default:
        // Escaped literal (\\, \., \+, etc.)
        if (/[{}()[\]|+*?.^$\\/]/.test(ch)) {
          return '\\' + ch;
        }
        return ch;
    }
  }

  /* ════════════════════════════════════════════════════
     EXECUTION — run the compiled lex rules on input
     ════════════════════════════════════════════════════ */

  setInput(input: string): void {
    this.inputBuffer = input;
    this.inputIndex = 0;
    this.state = { yytext: '', yyleng: 0, yylineno: 1 };
    this.output = [];
    this.isRunning = true;
  }

  run(): string[] {
    this.output = [];
    this.inputIndex = 0;
    this.isRunning = true;
    this.state.yylineno = 1;

    const input = this.inputBuffer;

    while (this.inputIndex < input.length && this.isRunning) {
      let bestMatch: { rule: LexRule; text: string } | null = null;

      // Try each rule — longest match wins; on tie, first rule wins
      for (const rule of this.rules) {
        rule.pattern.lastIndex = this.inputIndex;
        const m = rule.pattern.exec(input);

        if (m && m.index === this.inputIndex && m[0].length > 0) {
          if (!bestMatch || m[0].length > bestMatch.text.length) {
            bestMatch = { rule, text: m[0] };
          }
        }
      }

      if (bestMatch) {
        this.state.yytext = bestMatch.text;
        this.state.yyleng = bestMatch.text.length;
        this.executeAction(bestMatch.rule.action);
        // Count newlines in matched text
        for (const ch of bestMatch.text) {
          if (ch === '\n') this.state.yylineno++;
        }
        this.inputIndex += bestMatch.text.length;
      } else {
        // No rule matched — default: advance one character
        const ch = input[this.inputIndex];
        if (ch === '\n') this.state.yylineno++;
        this.inputIndex++;
      }
    }

    return this.output;
  }

  /**
   * Execute a rule's C-like action string
   */
  private executeAction(action: string): void {
    if (!action) return;

    const trimmed = action.trim();

    // Comment-only action → skip
    if (/^\/\*[\s\S]*\*\/$/.test(trimmed)) return;
    if (trimmed.startsWith('//')) return;

    // Multiple statements separated by semicolons or newlines
    const statements = this.splitStatements(trimmed);

    for (const stmt of statements) {
      this.executeSingleStatement(stmt.trim());
    }
  }

  /**
   * Split action body into individual statements
   */
  private splitStatements(action: string): string[] {
    const stmts: string[] = [];
    let current = '';
    let depth = 0;
    let inStr = false;
    let escaped = false;

    for (let i = 0; i < action.length; i++) {
      const ch = action[i];

      if (escaped) { current += ch; escaped = false; continue; }
      if (ch === '\\') { current += ch; escaped = true; continue; }
      if (ch === '"') { inStr = !inStr; current += ch; continue; }
      if (inStr) { current += ch; continue; }
      if (ch === '(') { depth++; current += ch; continue; }
      if (ch === ')') { depth--; current += ch; continue; }

      if ((ch === ';' || ch === '\n') && depth === 0) {
        if (current.trim()) stmts.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) stmts.push(current.trim());
    return stmts;
  }

  /**
   * Execute a single C-like statement
   */
  private executeSingleStatement(stmt: string): void {
    if (!stmt || stmt.startsWith('//')) return;
    // Comment
    if (stmt.startsWith('/*') && stmt.endsWith('*/')) return;

    // Remove trailing semicolons
    while (stmt.endsWith(';')) stmt = stmt.slice(0, -1).trim();
    if (!stmt) return;

    const yytext = this.state.yytext;
    const yyleng = this.state.yyleng;
    const yylineno = this.state.yylineno;

    // ── ECHO ──
    if (stmt === 'ECHO') {
      this.output.push(yytext);
      return;
    }

    // ── printf("format", args...) or fprintf(stdout, "format", args...) ──
    const printfMatch = stmt.match(
      /^(?:f?printf)\s*\(\s*(?:stdout\s*,\s*)?("(?:[^"\\]|\\.)*")\s*(?:,\s*([\s\S]*))?\)$/
    );
    if (printfMatch) {
      const format = printfMatch[1].slice(1, -1); // strip quotes
      const argsStr = printfMatch[2] || '';
      const args = argsStr ? this.parsePrintfArgs(argsStr) : [];

      let output = '';
      let argIdx = 0;

      for (let i = 0; i < format.length; i++) {
        if (format[i] === '\\') {
          i++;
          switch (format[i]) {
            case 'n': output += '\n'; break;
            case 't': output += '\t'; break;
            case 'r': output += '\r'; break;
            case '\\': output += '\\'; break;
            case '"': output += '"'; break;
            case '0': output += '\0'; break;
            default: output += format[i] || ''; break;
          }
        } else if (format[i] === '%' && i + 1 < format.length) {
          i++;
          // Skip width/precision modifiers
          while (i < format.length && /[0-9.\-+#lh]/.test(format[i])) i++;
          const spec = format[i];
          const arg = argIdx < args.length ? args[argIdx] : '';
          argIdx++;

          switch (spec) {
            case 's':
              output += this.resolveArg(arg, yytext, yyleng, yylineno);
              break;
            case 'd':
            case 'i':
            case 'l':
              output += this.resolveNumArg(arg, yytext, yyleng, yylineno);
              break;
            case 'f':
              output += this.resolveNumArg(arg, yytext, yyleng, yylineno);
              break;
            case 'c': {
              const val = this.resolveArg(arg, yytext, yyleng, yylineno);
              output += val.charAt(0);
              break;
            }
            case '%': output += '%'; argIdx--; break;
            default: output += spec || ''; break;
          }
        } else {
          output += format[i];
        }
      }

      this.output.push(output);
      return;
    }

    // ── puts("string") ──
    const putsMatch = stmt.match(/^puts\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)$/);
    if (putsMatch) {
      let str = putsMatch[1].slice(1, -1);
      str = this.unescapeC(str);
      this.output.push(str + '\n');
      return;
    }

    // ── putchar(expr) ──
    const putcharMatch = stmt.match(/^putchar\s*\(\s*(.+)\s*\)$/);
    if (putcharMatch) {
      const arg = putcharMatch[1].trim();
      if (arg.startsWith("'") && arg.endsWith("'")) {
        this.output.push(arg.slice(1, -1));
      } else if (arg === 'yytext[0]' || arg === '*yytext') {
        this.output.push(yytext.charAt(0));
      } else {
        this.output.push(arg);
      }
      return;
    }

    // ── return TOKEN ──
    if (stmt.startsWith('return')) {
      const token = stmt.replace(/^return\s+/, '').trim();
      if (token) {
        this.output.push(`[TOKEN: ${token}]`);
      }
      return;
    }

    // ── Variable increment: word_count++ ──
    const incrMatch = stmt.match(/^([a-zA-Z_]\w*)\s*\+\+$/);
    if (incrMatch) {
      const name = incrMatch[1];
      this.variables.set(name, (this.variables.get(name) || 0) + 1);
      return;
    }

    // ── Variable add-assign: char_count += yyleng ──
    const addAssignMatch = stmt.match(/^([a-zA-Z_]\w*)\s*\+=\s*(.+)$/);
    if (addAssignMatch) {
      const name = addAssignMatch[1];
      const val = addAssignMatch[2].trim();
      let numVal = 0;
      if (val === 'yyleng') numVal = yyleng;
      else if (!isNaN(Number(val))) numVal = Number(val);
      else numVal = 1;
      this.variables.set(name, (this.variables.get(name) || 0) + numVal);
      return;
    }

    // ── Variable decrement: count-- ──
    const decrMatch = stmt.match(/^([a-zA-Z_]\w*)\s*--$/);
    if (decrMatch) {
      const name = decrMatch[1];
      this.variables.set(name, (this.variables.get(name) || 0) - 1);
      return;
    }

    // ── Variable assignment: count = 0 ──
    const assignMatch = stmt.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)$/);
    if (assignMatch) {
      const name = assignMatch[1];
      const val = assignMatch[2].trim();
      if (val === 'yyleng') this.variables.set(name, yyleng);
      else if (val === 'yylineno') this.variables.set(name, yylineno);
      else if (!isNaN(Number(val))) this.variables.set(name, Number(val));
      else this.variables.set(name, 0);
      return;
    }

    // ── Lex builtins — not implemented in browser interpreter ──
    if (stmt === 'REJECT') { this.output.push('[Warning] REJECT is not supported in browser mode — use the backend compiler.'); return; }
    if (stmt.startsWith('BEGIN')) { this.output.push('[Warning] BEGIN (start conditions) is not supported in browser mode — use the backend compiler.'); return; }
    if (/^(yymore|yyless|unput|input)\s*\(/.test(stmt)) { this.output.push(`[Warning] ${stmt.split('(')[0]}() is not supported in browser mode — use the backend compiler.`); return; }
    if (stmt.startsWith('if') || stmt.startsWith('else') || stmt.startsWith('for') || stmt.startsWith('while')) return;
  }

  /**
   * Parse comma-separated printf arguments
   */
  private parsePrintfArgs(argsStr: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;
    let inStr = false;
    let escaped = false;

    for (let i = 0; i < argsStr.length; i++) {
      const ch = argsStr[i];
      if (escaped) { current += ch; escaped = false; continue; }
      if (ch === '\\') { current += ch; escaped = true; continue; }
      if (ch === '"') { inStr = !inStr; current += ch; continue; }
      if (!inStr && ch === '(') depth++;
      if (!inStr && ch === ')') depth--;
      if (!inStr && ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) args.push(current.trim());
    return args;
  }

  /**
   * Resolve a printf argument to its string value
   */
  private resolveArg(arg: string, yytext: string, yyleng: number, yylineno: number): string {
    if (!arg) return yytext;
    const t = arg.trim();
    if (t === 'yytext') return yytext;
    if (t === 'yyleng') return String(yyleng);
    if (t === 'yylineno') return String(yylineno);
    if (t.startsWith('yytext[') && t.endsWith(']')) {
      const idx = parseInt(t.slice(7, -1));
      return !isNaN(idx) && idx < yytext.length ? yytext[idx] : '';
    }
    if (t === '*yytext') return yytext.charAt(0);
    if (t.startsWith('"') && t.endsWith('"')) return this.unescapeC(t.slice(1, -1));
    if (this.variables.has(t)) return String(this.variables.get(t));
    return t;
  }

  /**
   * Resolve a printf argument to numeric value
   */
  private resolveNumArg(arg: string, yytext: string, yyleng: number, yylineno: number): string {
    if (!arg) return String(yyleng);
    const t = arg.trim();
    if (t === 'yyleng') return String(yyleng);
    if (t === 'yylineno') return String(yylineno);
    if (t === 'yytext') return yytext;
    if (this.variables.has(t)) return String(this.variables.get(t));
    if (!isNaN(Number(t))) return t;
    return String(this.variables.get(t) ?? t);
  }

  /**
   * Unescape C string escapes
   */
  private unescapeC(str: string): string {
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\0/g, '\0');
  }

  /**
   * Extract C variable declarations from %{ %} block
   */
  private extractVariables(cCode: string): void {
    const matches = cCode.matchAll(/\b(?:int|float|double|long|unsigned)\s+(\w+)\s*(?:=\s*([+-]?\d+(?:\.\d+)?))?\s*;/g);
    for (const m of matches) {
      const name = m[1];
      const val = m[2] !== undefined ? parseFloat(m[2]) : 0;
      this.variables.set(name, val);
    }
  }

  /* ════════════════════════════════════════════════════
     PUBLIC API
     ════════════════════════════════════════════════════ */

  reset(): void {
    this.inputBuffer = '';
    this.inputIndex = 0;
    this.output = [];
    this.state = { yytext: '', yyleng: 0, yylineno: 1 };
    this.error = null;
    this.isRunning = false;
  }

  stop(): void { this.isRunning = false; }

  getOutput(): string[] { return this.output; }
  getError(): string | null { return this.error; }
  getPatterns(): LexPattern[] { return this.patterns; }
  getDefinitions(): LexDefinition[] { return this.definitions; }
  getRules(): LexRule[] { return this.rules; }
  getVariables(): Map<string, number> { return new Map(this.variables); }
  isActive(): boolean { return this.isRunning; }

  /**
   * Generate the simulated lex.yy.c output
   */
  generateCode(): string {
    let code = '/* Generated by Lex Studio */\n';
    code += '#include <stdio.h>\n';
    code += '#include <stdlib.h>\n';
    code += '#include <string.h>\n';
    code += '#include <ctype.h>\n\n';

    if (this.declarations.trim()) {
      code += '/* Declarations */\n';
      code += this.declarations + '\n';
    }

    code += 'char *yytext;\n';
    code += 'int yyleng;\n';
    code += 'int yylineno = 1;\n\n';
    code += 'int yywrap() { return 1; }\n\n';

    if (this.definitions.length > 0) {
      code += '/* Definitions */\n';
      for (const def of this.definitions) {
        code += `/* ${def.name} = ${def.pattern} */\n`;
      }
      code += '\n';
    }

    code += `/* ${this.rules.length} rules */\n`;
    code += 'int yylex() {\n';
    for (const rule of this.rules) {
      const actionPreview = rule.action.replace(/\n/g, ' ').slice(0, 60);
      code += `    /* ${rule.patternSource}  →  ${actionPreview} */\n`;
    }
    code += '    return 0;\n';
    code += '}\n\n';

    if (this.userCode.trim()) {
      code += '/* User code */\n';
      code += this.userCode + '\n';
    } else {
      code += 'int main() {\n';
      code += '    yylex();\n';
      code += '    return 0;\n';
      code += '}\n';
    }

    return code;
  }
}

/* ════════════════════════════════════════════════════
   Utility: escape a literal string for use in a RegExp
   ════════════════════════════════════════════════════ */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
