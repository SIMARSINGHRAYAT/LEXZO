import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { LexFile, TerminalLine, EditorTab } from './types';
import { LexInterpreter } from './utils/lexer';
import { runLexOnServer, checkBackendHealth } from './api';
import WelcomePage from './WelcomePage';

/* ═══════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════ */

const DB_NAME = 'LexStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const THEME_KEY = 'lex-studio-theme';

/* ═══════════════════════════════════════════════════
   IndexedDB File System
   ═══════════════════════════════════════════════════ */

class FileSystem {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { this.db = request.result; resolve(); };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
    return this.initPromise;
  }

  async getAll(): Promise<LexFile[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async save(file: LexFile): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(file);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async remove(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async exists(name: string): Promise<boolean> {
    const files = await this.getAll();
    return files.some(f => f.name.toLowerCase() === name.toLowerCase());
  }
}

const fileSystem = new FileSystem();
const uid = () => Math.random().toString(36).slice(2, 15);

/* ═══════════════════════════════════════════════════
   Sample Files
   ═══════════════════════════════════════════════════ */

const SAMPLE_FILES: Omit<LexFile, 'id'>[] = [
  {
    name: 'scanner.l',
    content: `%{
#include <stdio.h>
%}
%%
[0-9]+      { printf("NUMBER: %s\\n", yytext); }
[a-zA-Z]+   { printf("WORD: %s\\n", yytext); }
[ \\t\\n]    { /* ignore whitespace */ }
.           { printf("CHAR: %c\\n", yytext[0]); }
%%
int main() {
    yylex();
    return 0;
}`,
    modified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    name: 'input.txt',
    content: 'Hello World 123 Test 456',
    modified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    name: 'calculator.l',
    content: `%{
#include <stdio.h>
%}
%%
[0-9]+\\.[0-9]+   { printf("FLOAT: %s\\n", yytext); }
[0-9]+            { printf("INT: %s\\n", yytext); }
"+"               { printf("PLUS\\n"); }
"-"               { printf("MINUS\\n"); }
"*"               { printf("MULT\\n"); }
"/"               { printf("DIV\\n"); }
"("               { printf("LPAREN\\n"); }
")"               { printf("RPAREN\\n"); }
"="               { printf("ASSIGN\\n"); }
[ \\t\\n]          { /* skip */ }
%%
int main() { yylex(); return 0; }`,
    modified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    name: 'wordcount.l',
    content: `%{
#include <stdio.h>
int char_count = 0;
int word_count = 0;
int line_count = 0;
%}

letter  [a-zA-Z]
digit   [0-9]
word    {letter}({letter}|{digit})*

%%
{word}      { word_count++; char_count += yyleng; }
\\n          { char_count++; line_count++; }
.           { char_count++; }
%%
int main() {
    yylex();
    printf("Lines: %d\\n", line_count);
    printf("Words: %d\\n", word_count);
    printf("Chars: %d\\n", char_count);
    return 0;
}`,
    modified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    name: 'identifier.l',
    content: `%{
#include <stdio.h>
%}

digit    [0-9]
letter   [a-zA-Z_]
id       {letter}({letter}|{digit})*

%%
"if"        { printf("KEYWORD_IF\\n"); }
"else"      { printf("KEYWORD_ELSE\\n"); }
"while"     { printf("KEYWORD_WHILE\\n"); }
"for"       { printf("KEYWORD_FOR\\n"); }
"int"       { printf("KEYWORD_INT\\n"); }
"float"     { printf("KEYWORD_FLOAT\\n"); }
"return"    { printf("KEYWORD_RETURN\\n"); }
{id}        { printf("IDENTIFIER: %s\\n", yytext); }
{digit}+    { printf("NUMBER: %s\\n", yytext); }
"=="        { printf("EQ\\n"); }
"!="        { printf("NEQ\\n"); }
"<="        { printf("LE\\n"); }
">="        { printf("GE\\n"); }
"<"         { printf("LT\\n"); }
">"         { printf("GT\\n"); }
"="         { printf("ASSIGN\\n"); }
"+"         { printf("PLUS\\n"); }
"-"         { printf("MINUS\\n"); }
"*"         { printf("MULT\\n"); }
"/"         { printf("DIV\\n"); }
";"         { printf("SEMICOLON\\n"); }
"{"         { printf("LBRACE\\n"); }
"}"         { printf("RBRACE\\n"); }
"("         { printf("LPAREN\\n"); }
")"         { printf("RPAREN\\n"); }
[ \\t\\n]    { /* skip whitespace */ }
.           { printf("UNKNOWN: %c\\n", yytext[0]); }
%%
int main() { yylex(); return 0; }`,
    modified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

/* ═══════════════════════════════════════════════════
   Monaco Lex Language Registration
   ═══════════════════════════════════════════════════ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerLexLanguage(monaco: any) {
  if (monaco.languages.getLanguages().some((l: { id: string }) => l.id === 'lex')) return;

  monaco.languages.register({ id: 'lex' });

  monaco.languages.setMonarchTokensProvider('lex', {
    defaultToken: '',
    tokenPostfix: '.lex',

    keywords: [
      'return', 'printf', 'fprintf', 'sprintf', 'putchar', 'puts',
      'int', 'char', 'float', 'double', 'void', 'if', 'else', 'while', 'for',
      'switch', 'case', 'break', 'continue', 'struct', 'typedef', 'enum',
      'include', 'define', 'ifdef', 'ifndef', 'endif', 'ECHO', 'BEGIN', 'REJECT',
      'yymore', 'yyless', 'unput', 'input', 'main', 'sizeof',
    ],

    builtins: [
      'yytext', 'yyleng', 'yylineno', 'yyin', 'yyout', 'yylval',
      'yywrap', 'yylex', 'yyerror', 'yyparse', 'YYSTYPE', 'stdout', 'stderr',
    ],

    tokenizer: {
      root: [
        [/^%%/, 'keyword'],
        [/%\{/, 'keyword', '@ccode'],
        [/%option\b/, 'keyword'],
        [/%[a-zA-Z]+/, 'keyword'],
        [/#\s*include\b/, 'keyword'],
        [/#\s*define\b/, 'keyword'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\[/, 'regexp', '@charclass'],
        [/\d+(\.\d+)?/, 'number'],
        [/\{/, 'delimiter.bracket', '@action'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'variable.predefined',
            '@default': 'identifier'
          }
        }],
        [/[+*?|().]/, 'operator'],
        [/\\[ntrfvabedDwWsS0-9]/, 'regexp.escape'],
        [/[ \t\r\n]+/, 'white'],
      ],

      ccode: [
        [/%\}/, 'keyword', '@pop'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/#\s*\w+/, 'keyword'],
        [/\d+/, 'number'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'variable.predefined',
            '@default': 'identifier'
          }
        }],
        [/./, ''],
      ],

      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],

      action: [
        [/\{/, 'delimiter.bracket', '@push'],
        [/\}/, 'delimiter.bracket', '@pop'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\d+/, 'number'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'variable.predefined',
            '@default': 'identifier'
          }
        }],
        [/[+\-*/%=<>!&|^~]+/, 'operator'],
        [/./, ''],
      ],

      charclass: [
        [/\]/, 'regexp', '@pop'],
        [/\\[ntrfvabedDwWsS0-9]/, 'regexp.escape'],
        [/[^\]\\]/, 'regexp'],
        [/\\./, 'regexp.escape'],
      ],
    },
  });

  monaco.editor.defineTheme('lex-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword.lex', foreground: '569CD6' },
      { token: 'string.lex', foreground: 'CE9178' },
      { token: 'comment.lex', foreground: '6A9955' },
      { token: 'number.lex', foreground: 'B5CEA8' },
      { token: 'operator.lex', foreground: 'D4D4D4' },
      { token: 'delimiter.bracket.lex', foreground: 'FFD700' },
      { token: 'variable.predefined.lex', foreground: '4EC9B0' },
      { token: 'identifier.lex', foreground: '9CDCFE' },
      { token: 'regexp.lex', foreground: 'D16969' },
      { token: 'regexp.escape.lex', foreground: 'D7BA7D' },
    ],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
    }
  });

  monaco.editor.defineTheme('lex-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword.lex', foreground: '0000FF' },
      { token: 'string.lex', foreground: 'A31515' },
      { token: 'comment.lex', foreground: '008000' },
      { token: 'number.lex', foreground: '098658' },
      { token: 'variable.predefined.lex', foreground: '267F99' },
      { token: 'identifier.lex', foreground: '001080' },
      { token: 'regexp.lex', foreground: '811F3F' },
      { token: 'regexp.escape.lex', foreground: 'EE0000' },
      { token: 'delimiter.bracket.lex', foreground: 'AF00DB' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#333333',
    }
  });

  monaco.languages.setLanguageConfiguration('lex', {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });
}

/* ═══════════════════════════════════════════════════
   App Component
   ═══════════════════════════════════════════════════ */

type Theme = 'dark' | 'light';

function App() {
  /* ── State ── */
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem(THEME_KEY) as Theme) || 'dark'
  );
  const [showWelcome, setShowWelcome] = useState(() => {
    return !sessionStorage.getItem('lex-studio-welcomed');
  });
  const [files, setFiles] = useState<LexFile[]>([]);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [terminalInput, setTerminalInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);
  const [lexProgram, setLexProgram] = useState<LexInterpreter | null>(null);
  const [compiledProgramName, setCompiledProgramName] = useState('');
  const [inputMode, setInputMode] = useState(false);
  const [inputLineText, setInputLineText] = useState('');
  const [pendingInput, setPendingInput] = useState<string[]>([]);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showInputDialog, setShowInputDialog] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [backendAvailable, setBackendAvailable] = useState(false);

  /* ── Refs ── */
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const inputModeRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const filesRef = useRef(files);
  const activeTabRef = useRef(activeTab);

  filesRef.current = files;
  activeTabRef.current = activeTab;

  const isDark = theme === 'dark';

  const dismissWelcome = useCallback(() => {
    sessionStorage.setItem('lex-studio-welcomed', '1');
    setShowWelcome(false);
  }, []);

  /* ── Helpers ── */
  const addLine = useCallback((content: string, type: TerminalLine['type'] = 'output') => {
    setTerminalLines(prev => [...prev, { id: uid(), type, content, timestamp: Date.now() }]);
  }, []);

  const getActiveFile = useCallback((): LexFile | undefined => {
    return filesRef.current.find(f => f.id === activeTabRef.current);
  }, []);

  /* ── Effects ── */

  // Load files from IndexedDB on mount
  useEffect(() => {
    const init = async () => {
      let stored = await fileSystem.getAll();
      if (stored.length === 0) {
        for (const sample of SAMPLE_FILES) {
          const file: LexFile = { ...sample, id: uid() };
          await fileSystem.save(file);
        }
        stored = await fileSystem.getAll();
      }
      setFiles(stored);
      if (stored.length > 0) {
        setTabs([{ fileId: stored[0].id, fileName: stored[0].name }]);
        setActiveTab(stored[0].id);
      }

      // Check if the real Flex/GCC backend is reachable
      const alive = await checkBackendHealth();
      setBackendAvailable(alive);
      if (alive) {
        addLine('Backend connected — real Flex + GCC available', 'success');
      }
    };
    init();
    addLine('╔══════════════════════════════════════╗', 'info');
    addLine('║     Lex Studio v1.0 — Ready          ║', 'info');
    addLine('║     Type "help" for commands          ║', 'info');
    addLine('╚══════════════════════════════════════╝', 'info');
  }, [addLine]);

  // Persist theme
  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLines]);

  // Focus input mode
  useEffect(() => {
    if (inputMode && inputModeRef.current) inputModeRef.current.focus();
  }, [inputMode]);

  // Close context menu on click outside
  useEffect(() => {
    const h = () => setContextMenu(null);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  // Keyboard shortcuts (Ctrl+S, Ctrl+B, Ctrl+`)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const file = filesRef.current.find(f => f.id === activeTabRef.current);
        if (file) {
          fileSystem.save({ ...file, modified: false });
          setFiles(prev => prev.map(f => f.id === file.id ? { ...f, modified: false } : f));
          setTerminalLines(prev => [...prev, {
            id: uid(), type: 'success', content: `Saved: ${file.name}`, timestamp: Date.now()
          }]);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarVisible(v => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setTerminalVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Debounced auto-save to IndexedDB
  useEffect(() => {
    const t = setTimeout(() => { files.forEach(f => fileSystem.save(f)); }, 500);
    return () => clearTimeout(t);
  }, [files]);

  /* ── File Operations ── */

  const openFile = useCallback((fileId: string) => {
    const file = filesRef.current.find(f => f.id === fileId);
    if (!file) return;
    setTabs(prev => {
      if (prev.find(t => t.fileId === fileId)) return prev;
      return [...prev, { fileId: file.id, fileName: file.name }];
    });
    setActiveTab(fileId);
  }, []);

  const closeTab = useCallback((fileId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const file = filesRef.current.find(f => f.id === fileId);
    if (file?.modified) {
      fileSystem.save({ ...file, modified: false });
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, modified: false } : f));
    }
    setTabs(prev => {
      const next = prev.filter(t => t.fileId !== fileId);
      if (activeTabRef.current === fileId) {
        setActiveTab(next.length > 0 ? next[next.length - 1].fileId : null);
      }
      return next;
    });
  }, []);

  const createFile = useCallback(async (name: string) => {
    let fileName = name.trim();
    if (!fileName) return;
    if (/[<>:"\/\\|?*\x00-\x1f]/.test(fileName) || /^\.\.?$/.test(fileName)) {
      addLine(`Invalid file name: "${fileName}"`, 'error');
      return;
    }
    if (!fileName.includes('.')) fileName += '.l';

    const exists = await fileSystem.exists(fileName);
    if (exists) { addLine(`File "${fileName}" already exists`, 'error'); return; }

    const newFile: LexFile = {
      id: uid(), name: fileName, content: '', modified: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    await fileSystem.save(newFile);
    setFiles(prev => [...prev, newFile]);
    openFile(newFile.id);
    addLine(`Created: ${fileName}`, 'success');
  }, [addLine, openFile]);

  const deleteFileById = useCallback(async (fileId: string) => {
    const file = filesRef.current.find(f => f.id === fileId);
    if (!file) return;
    await fileSystem.remove(fileId);
    setFiles(prev => prev.filter(f => f.id !== fileId));
    closeTab(fileId);
    addLine(`Deleted: ${file.name}`, 'success');
    setContextMenu(null);
  }, [addLine, closeTab]);

  const renameFileById = useCallback(async (fileId: string, newName: string) => {
    const file = filesRef.current.find(f => f.id === fileId);
    if (!file) return;
    let finalName = newName.trim();
    if (!finalName.includes('.')) finalName += '.l';

    const exists = await fileSystem.exists(finalName);
    if (exists && finalName.toLowerCase() !== file.name.toLowerCase()) {
      addLine(`File "${finalName}" already exists`, 'error');
      return;
    }

    const updated = { ...file, name: finalName, updatedAt: Date.now() };
    await fileSystem.remove(fileId);
    await fileSystem.save(updated);
    setFiles(prev => prev.map(f => f.id === fileId ? updated : f));
    setTabs(prev => prev.map(t => t.fileId === fileId ? { ...t, fileName: finalName } : t));
    addLine(`Renamed: ${file.name} → ${finalName}`, 'success');
    setContextMenu(null);
  }, [addLine]);

  /* ── Monaco Editor Handlers ── */

  const handleEditorWillMount = useCallback((monaco: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    registerLexLanguage(monaco);
  }, []);

  const handleEditorDidMount = useCallback((editor: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      setCursorPosition({ line: e.position.lineNumber, column: e.position.column });
    });
  }, []);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeTabRef.current || value === undefined) return;
    setFiles(prev => prev.map(f =>
      f.id === activeTabRef.current
        ? { ...f, content: value, modified: true, updatedAt: Date.now() }
        : f
    ));
  }, []);

  /* ── Terminal Command Processing ── */

  const processCommand = useCallback(async (rawInput: string) => {
    addLine(`user@lexstudio:~$ ${rawInput}`, 'command');

    const parts = rawInput.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    switch (cmd) {
      case 'help':
        addLine('', 'output');
        addLine('  File Commands:', 'info');
        addLine('    new <name>           Create a new file', 'output');
        addLine('    open <name>          Open file in editor', 'output');
        addLine('    save [name]          Save current/named file', 'output');
        addLine('    cat <name>           Display file contents', 'output');
        addLine('    rm <name>            Delete a file', 'output');
        addLine('    rename <old> <new>   Rename a file', 'output');
        addLine('    ls                   List all files', 'output');
        addLine('', 'output');
        addLine('  Lex Workflow:', 'info');
        addLine('    lex <file.l>              Compile (browser interpreter)', 'output');
        addLine('    flex <file.l>             Compile + run (server Flex/GCC)', 'output');
        addLine('    gcc lex.yy.c -o <prog>    Link step (browser)', 'output');
        addLine('    ./<prog>                  Run compiled program', 'output');
        addLine('    run [file.l]              Quick compile + run', 'output');
        addLine('', 'output');
        addLine('  System:', 'info');
        addLine('    clear                Clear terminal', 'output');
        addLine('    help                 Show this help', 'output');
        addLine('', 'output');
        addLine('  Shortcuts:', 'info');
        addLine('    Ctrl+S   Save file     Ctrl+B   Toggle sidebar', 'output');
        addLine('    Ctrl+`   Toggle terminal', 'output');
        break;

      case 'clear':
        setTerminalLines([]);
        break;

      case 'ls': {
        const currentFiles = filesRef.current;
        if (currentFiles.length === 0) {
          addLine('  (no files)', 'output');
        } else {
          currentFiles.forEach(f => {
            const icon = f.name.endsWith('.l') ? '⚡' : f.name.endsWith('.c') ? '📃' : '📄';
            const mod = f.modified ? ' *' : '';
            addLine(`  ${icon} ${f.name}${mod}`, 'output');
          });
        }
        break;
      }

      case 'new':
        if (args.length === 0) {
          setShowNewFileDialog(true);
        } else {
          await createFile(args.join(' '));
        }
        break;

      case 'open': {
        if (args.length === 0) { addLine('Usage: open <filename>', 'error'); break; }
        const name = args.join(' ');
        const file = filesRef.current.find(f => f.name.toLowerCase() === name.toLowerCase());
        if (file) {
          openFile(file.id);
          addLine(`Opened: ${file.name}`, 'success');
        } else {
          addLine(`File not found: ${name}`, 'error');
        }
        break;
      }

      case 'save': {
        if (args.length > 0) {
          const name = args.join(' ');
          const file = filesRef.current.find(f => f.name.toLowerCase() === name.toLowerCase());
          if (file) {
            await fileSystem.save({ ...file, modified: false });
            setFiles(prev => prev.map(f => f.id === file.id ? { ...f, modified: false } : f));
            addLine(`Saved: ${file.name}`, 'success');
          } else {
            addLine(`File not found: ${name}`, 'error');
          }
        } else {
          const file = getActiveFile();
          if (file) {
            await fileSystem.save({ ...file, modified: false });
            setFiles(prev => prev.map(f => f.id === file.id ? { ...f, modified: false } : f));
            addLine(`Saved: ${file.name}`, 'success');
          } else {
            addLine('No file open to save', 'error');
          }
        }
        break;
      }

      case 'cat': {
        if (args.length === 0) { addLine('Usage: cat <filename>', 'error'); break; }
        const name = args.join(' ');
        const file = filesRef.current.find(f => f.name.toLowerCase() === name.toLowerCase());
        if (file) {
          addLine(`─── ${file.name} ───`, 'info');
          file.content.split('\n').forEach(line => addLine(line, 'output'));
          addLine(`─── end ───`, 'info');
        } else {
          addLine(`File not found: ${name}`, 'error');
        }
        break;
      }

      case 'rm':
      case 'delete': {
        if (args.length === 0) { addLine('Usage: rm <filename>', 'error'); break; }
        const name = args.join(' ');
        const file = filesRef.current.find(f => f.name.toLowerCase() === name.toLowerCase());
        if (file) {
          await deleteFileById(file.id);
        } else {
          addLine(`File not found: ${name}`, 'error');
        }
        break;
      }

      case 'rename': {
        if (args.length < 2) { addLine('Usage: rename <old> <new>', 'error'); break; }
        const oldName = args[0];
        const newName = args.slice(1).join(' ');
        const file = filesRef.current.find(f => f.name.toLowerCase() === oldName.toLowerCase());
        if (file) {
          await renameFileById(file.id, newName);
        } else {
          addLine(`File not found: ${oldName}`, 'error');
        }
        break;
      }

      case 'lex': {
        if (args.length === 0) { addLine('Usage: lex <filename.l>', 'error'); break; }
        const name = args[0];
        const file = filesRef.current.find(f => f.name.toLowerCase() === name.toLowerCase());
        if (!file) { addLine(`File not found: ${name}`, 'error'); break; }
        if (!file.name.endsWith('.l')) { addLine('Error: file must have .l extension', 'error'); break; }

        addLine(`Compiling ${file.name}...`, 'info');
        if (backendAvailable) {
          addLine('Using server (real Flex + GCC)...', 'info');
        }
        const lexer = new LexInterpreter();
        const result = lexer.parse(file.content);

        if (result.success) {
          setLexProgram(lexer);
          const patterns = lexer.getPatterns();
          addLine(`lex: ${file.name} → lex.yy.c  (${patterns.length} rules)`, 'success');
          addLine('Next: gcc lex.yy.c -o <program>', 'info');
        } else {
          addLine(`Error: ${result.error}`, 'error');
        }
        break;
      }

      case 'flex': {
        // Real backend compilation with Flex + GCC
        if (!backendAvailable) {
          addLine('Backend not available — start the Flask server or use Docker', 'error');
          addLine('Hint: use "lex" for browser-based interpretation', 'info');
          break;
        }
        if (args.length === 0) { addLine('Usage: flex <filename.l>', 'error'); break; }
        const name = args[0];
        const file = filesRef.current.find(f => f.name.toLowerCase() === name.toLowerCase());
        if (!file) { addLine(`File not found: ${name}`, 'error'); break; }
        if (!file.name.endsWith('.l')) { addLine('Error: file must have .l extension', 'error'); break; }

        // Also parse locally so lex/gcc/./ workflow still works
        const lexer = new LexInterpreter();
        lexer.parse(file.content);
        setLexProgram(lexer);
        setCompiledProgramName(file.name.replace('.l', ''));

        addLine(`Compiling ${file.name} on server (Flex + GCC)...`, 'info');
        addLine('Enter input (press Enter on empty line to finish, Esc to cancel):', 'info');
        setInputMode(true);
        setPendingInput([]);
        setInputLineText('');
        break;
      }

      case 'gcc': {
        if (args.length === 0) { addLine('Usage: gcc lex.yy.c -o <program>', 'error'); break; }
        if (!args.includes('lex.yy.c')) {
          addLine('gcc: expected lex.yy.c — run "lex <file.l>" first', 'error');
          break;
        }
        if (!lexProgram) {
          addLine('gcc: no lexer compiled — run "lex <file.l>" first', 'error');
          break;
        }
        const oIdx = args.indexOf('-o');
        const outName = oIdx !== -1 && args[oIdx + 1] ? args[oIdx + 1] : 'a.out';

        addLine(`gcc: compiling lex.yy.c...`, 'info');
        setCompiledProgramName(outName);
        addLine(`gcc: lex.yy.c → ${outName}`, 'success');
        addLine(`Next: ./${outName}`, 'info');
        break;
      }

      case 'run': {
        let targetFile: LexFile | undefined;
        if (args.length > 0) {
          targetFile = filesRef.current.find(f => f.name.toLowerCase() === args[0].toLowerCase());
        } else {
          targetFile = getActiveFile();
        }
        if (!targetFile) { addLine('Usage: run [file.l] — or open a .l file first', 'error'); break; }
        if (!targetFile.name.endsWith('.l')) { addLine('Error: Can only run .l files', 'error'); break; }

        const lexer = new LexInterpreter();
        const result = lexer.parse(targetFile.content);
        if (result.success) {
          setLexProgram(lexer);
          setCompiledProgramName(targetFile.name.replace('.l', ''));
          addLine(`Compiled ${targetFile.name} (${lexer.getPatterns().length} rules)`, 'success');
          if (backendAvailable) {
            addLine('Server backend available — will use real Flex + GCC', 'info');
          }
          addLine('Enter input (press Enter on empty line to finish, Esc to cancel):', 'info');
          setInputMode(true);
          setPendingInput([]);
          setInputLineText('');
        } else {
          addLine(`Error: ${result.error}`, 'error');
        }
        break;
      }

      default:
        if (cmd.startsWith('./')) {
          const progName = cmd.slice(2);
          if (!lexProgram || !compiledProgramName) {
            addLine(`bash: ${cmd}: No such file or directory`, 'error');
            addLine('Hint: run "lex <file.l>" then "gcc lex.yy.c -o <prog>"', 'info');
            break;
          }
          if (progName !== compiledProgramName && progName !== 'a.out') {
            addLine(`bash: ${cmd}: No such file or directory`, 'error');
            addLine(`Hint: compiled program is "./${compiledProgramName}"`, 'info');
            break;
          }
          addLine(`Running ./${progName}...`, 'info');
          addLine('Enter input (press Enter on empty line to finish, Esc to cancel):', 'info');
          setInputMode(true);
          setPendingInput([]);
          setInputLineText('');
        } else {
          addLine(`bash: ${cmd}: command not found`, 'error');
          addLine('Type "help" for available commands', 'info');
        }
        break;
    }
  }, [addLine, createFile, openFile, deleteFileById, renameFileById, getActiveFile, lexProgram, compiledProgramName, backendAvailable]);

  /* ── Input Mode Handlers ── */

  const handleInputSubmit = useCallback(async () => {
    if (!lexProgram) { setInputMode(false); return; }
    const input = pendingInput.join('\n');
    addLine('─────────── Lexer Output ───────────', 'info');

    if (!input.trim()) {
      addLine('(no input provided)', 'output');
      addLine('────────────────────────────────────', 'info');
      setInputMode(false);
      setPendingInput([]);
      setInputLineText('');
      return;
    }

    // Try real backend first (Flex + GCC)
    if (backendAvailable) {
      const activeFile = getActiveFile();
      const code = activeFile?.content || '';
      if (code) {
        addLine('Sending to server (Flex + GCC)...', 'info');
        try {
          const apiResult = await runLexOnServer(code, input);
          if (apiResult.status === 'success') {
            addLine('[Server: Flex + GCC]', 'info');
            const lines = apiResult.output.split('\n').filter((l: string) => l.length > 0);
            if (lines.length === 0) {
              addLine('(no output)', 'output');
            } else {
              lines.forEach((line: string) => addLine(line, 'success'));
            }
            if (apiResult.error) {
              addLine(`stderr: ${apiResult.error}`, 'error');
            }
          } else if (apiResult.status === 'compile_error') {
            addLine('[Server: Compilation Error]', 'error');
            addLine(apiResult.error, 'error');
            if (apiResult.flex_output) addLine(`flex: ${apiResult.flex_output}`, 'error');
            if (apiResult.gcc_output) addLine(`gcc: ${apiResult.gcc_output}`, 'error');
            addLine('Falling back to browser interpreter...', 'info');
            // Fall through to local execution below
            runLocally();
          } else if (apiResult.status === 'runtime_error') {
            addLine('[Server: Runtime Error]', 'error');
            if (apiResult.output) {
              apiResult.output.split('\n').filter((l: string) => l.length > 0)
                .forEach((line: string) => addLine(line, 'success'));
            }
            addLine(apiResult.error, 'error');
          } else {
            addLine(`[Server Error] ${apiResult.error}`, 'error');
            addLine('Falling back to browser interpreter...', 'info');
            runLocally();
          }

          addLine('────────────────────────────────────', 'info');
          setInputMode(false);
          setPendingInput([]);
          setInputLineText('');
          return;
        } catch {
          addLine('Server unreachable — falling back to browser interpreter', 'error');
        }
      }
    }

    // Local (browser) execution
    runLocally();
    addLine('────────────────────────────────────', 'info');
    setInputMode(false);
    setPendingInput([]);
    setInputLineText('');

    function runLocally() {
      lexProgram.setInput(input);
      const output = lexProgram.run();
      const flatOutput = output.join('').split('\n').filter((l: string) => l.length > 0);
      if (flatOutput.length === 0) {
        addLine('(no output)', 'output');
      } else {
        addLine('[Browser Interpreter]', 'info');
        flatOutput.forEach((line: string) => addLine(line, 'success'));
      }

      const vars = lexProgram.getVariables();
      if (vars.size > 0) {
        addLine('── Variables ──', 'info');
        vars.forEach((val: number, key: string) => addLine(`  ${key} = ${val}`, 'success'));
      }
    }
  }, [lexProgram, pendingInput, addLine, backendAvailable, getActiveFile]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputLineText === '' && pendingInput.length > 0) {
        handleInputSubmit();
      } else {
        addLine(`> ${inputLineText}`, 'input');
        setPendingInput(prev => [...prev, inputLineText]);
        setInputLineText('');
      }
    } else if (e.key === 'Escape') {
      setInputMode(false);
      setPendingInput([]);
      setInputLineText('');
      addLine('(input cancelled)', 'error');
    }
  }, [inputLineText, pendingInput, handleInputSubmit, addLine]);

  /* ── Terminal Key Handling ── */

  const handleTerminalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (terminalInput.trim()) {
        processCommand(terminalInput);
        setCommandHistory(prev => [...prev, terminalInput]);
        setHistoryIndex(-1);
      }
      setTerminalInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIdx = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIdx);
        setTerminalInput(commandHistory[newIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1 && historyIndex < commandHistory.length - 1) {
        setHistoryIndex(historyIndex + 1);
        setTerminalInput(commandHistory[historyIndex + 1]);
      } else {
        setHistoryIndex(-1);
        setTerminalInput('');
      }
    }
  }, [terminalInput, commandHistory, historyIndex, processCommand]);

  /* ── Run With Dialog ── */

  const handleRunWithDialog = useCallback(() => {
    const file = getActiveFile();
    if (!file || !file.name.endsWith('.l')) {
      addLine('Open a .l file to run', 'error');
      return;
    }
    const lexer = new LexInterpreter();
    const result = lexer.parse(file.content);
    if (result.success) {
      setLexProgram(lexer);
      setShowInputDialog(true);
    } else {
      addLine(`Error: ${result.error}`, 'error');
    }
  }, [getActiveFile, addLine]);

  const handleDialogRun = useCallback(async () => {
    if (!lexProgram) { setShowInputDialog(false); return; }

    addLine(`user@lexstudio:~$ ./${compiledProgramName || 'program'}`, 'command');
    addLine(`Input: "${customInput.length > 100 ? customInput.substring(0, 100) + '...' : customInput}"`, 'info');
    addLine('─────────── Lexer Output ───────────', 'info');

    // Try backend first
    if (backendAvailable) {
      const activeFile = getActiveFile();
      if (activeFile?.content) {
        try {
          addLine('Sending to server (Flex + GCC)...', 'info');
          const apiResult = await runLexOnServer(activeFile.content, customInput);
          if (apiResult.status === 'success') {
            addLine('[Server: Flex + GCC]', 'info');
            const lines = apiResult.output.split('\n').filter((l: string) => l.length > 0);
            lines.forEach((line: string) => addLine(line, 'success'));
            if (apiResult.error) addLine(`stderr: ${apiResult.error}`, 'error');
          } else {
            addLine(`[Server: ${apiResult.status}]`, 'error');
            addLine(apiResult.error, 'error');
            addLine('Falling back to browser interpreter...', 'info');
            runLocalDialog();
          }
          addLine('────────────────────────────────────', 'info');
          setShowInputDialog(false);
          setCustomInput('');
          return;
        } catch {
          addLine('Server unreachable — using browser interpreter', 'error');
        }
      }
    }

    // Local fallback
    runLocalDialog();
    addLine('────────────────────────────────────', 'info');
    setShowInputDialog(false);
    setCustomInput('');

    function runLocalDialog() {
      lexProgram.setInput(customInput);
      const output = lexProgram.run();
      const flatOutput = output.join('').split('\n').filter((l: string) => l.length > 0);
      if (flatOutput.length === 0) {
        addLine('(no output)', 'output');
      } else {
        addLine('[Browser Interpreter]', 'info');
        flatOutput.forEach((line: string) => addLine(line, 'success'));
      }
      const vars = lexProgram.getVariables();
      if (vars.size > 0) {
        addLine('── Variables ──', 'info');
        vars.forEach((val: number, key: string) => addLine(`  ${key} = ${val}`, 'success'));
      }
    }
  }, [lexProgram, customInput, compiledProgramName, addLine, backendAvailable, getActiveFile]);

  /* ── Misc Handlers ── */

  const handleContextMenu = useCallback((e: React.MouseEvent, fileId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, fileId });
  }, []);

  const getLanguage = (name: string) => {
    if (name.endsWith('.l')) return 'lex';
    if (name.endsWith('.c') || name.endsWith('.h')) return 'c';
    return 'plaintext';
  };

  const activeFile = files.find(f => f.id === activeTab);

  /* ═══════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════ */

  return (
    <div
      className={`h-screen flex flex-col overflow-hidden select-none ${
        isDark ? 'bg-[#1e1e1e] text-[#d4d4d4]' : 'bg-white text-[#333333]'
      }`}
      style={{ fontFamily: "'Segoe UI', -apple-system, sans-serif" }}
    >
      {/* ── Welcome Page ── */}
      {showWelcome && <WelcomePage isDark={isDark} onEnter={dismissWelcome} />}

      {/* ── Title Bar ── */}
      <div className={`h-9 flex items-center justify-between px-4 shrink-0 ${
        isDark ? 'bg-[#323233] border-[#3c3c3c]' : 'bg-[#dddddd] border-[#cccccc]'
      } border-b`}>
        <div className="flex items-center gap-3">
          <svg className="w-4 h-4 text-[#007acc]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M13.5 2L3 14h6.5L10 22l10.5-12H14L13.5 2z" />
          </svg>
          <span className="text-xs font-semibold tracking-wide opacity-80">LEX STUDIO</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className={`p-1 rounded-sm transition-colors ${isDark ? 'hover:bg-white/10 text-yellow-400' : 'hover:bg-black/10 text-gray-600'}`}
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>
        </div>
      </div>

      {/* ── Menu Bar ── */}
      <div className={`h-7 flex items-center px-2 gap-0.5 shrink-0 text-xs ${
        isDark ? 'bg-[#3c3c3c] border-[#3c3c3c]' : 'bg-[#f3f3f3] border-[#d4d4d4]'
      } border-b`}>
        <button onClick={() => setShowNewFileDialog(true)}
          className={`px-3 py-0.5 rounded-sm ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}>File</button>
        <button className={`px-3 py-0.5 rounded-sm ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}>Edit</button>
        <button onClick={() => setSidebarVisible(v => !v)}
          className={`px-3 py-0.5 rounded-sm ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}>View</button>
        <button onClick={handleRunWithDialog}
          className={`px-3 py-0.5 rounded-sm ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}>Run</button>
        <button onClick={() => processCommand('help')}
          className={`px-3 py-0.5 rounded-sm ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}>Help</button>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Sidebar ── */}
        {sidebarVisible && (
          <div className={`w-56 shrink-0 flex flex-col ${
            isDark ? 'bg-[#252526] border-[#3c3c3c]' : 'bg-[#f3f3f3] border-[#d4d4d4]'
          } border-r`}>
            <div className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-wider ${
              isDark ? 'text-[#bbbbbb]' : 'text-[#6f6f6f]'
            }`}>Explorer</div>

            <div className={`px-3 py-1.5 flex items-center justify-between ${
              isDark ? 'bg-[#2d2d2d]' : 'bg-[#e8e8e8]'
            }`}>
              <span className={`text-[11px] font-semibold uppercase tracking-wider ${
                isDark ? 'text-[#cccccc]' : 'text-[#616161]'
              }`}>Lex Files</span>
              <button
                onClick={() => setShowNewFileDialog(true)}
                className={`p-0.5 rounded-sm ${isDark ? 'hover:bg-white/10 text-[#cccccc]' : 'hover:bg-black/10 text-[#616161]'}`}
                title="New File (Ctrl+N)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {files.map(file => (
                <div
                  key={file.id}
                  onClick={() => openFile(file.id)}
                  onContextMenu={(e) => handleContextMenu(e, file.id)}
                  className={`flex items-center gap-2 px-4 py-[3px] cursor-pointer text-[13px] ${
                    activeTab === file.id
                      ? isDark ? 'bg-[#37373d] text-white' : 'bg-[#e4e6f1] text-black'
                      : isDark ? 'text-[#cccccc] hover:bg-[#2a2d2e]' : 'text-[#333333] hover:bg-[#e8e8e8]'
                  }`}
                >
                  <span className={`text-xs ${
                    file.name.endsWith('.l') ? (isDark ? 'text-[#e8ab53]' : 'text-[#b8860b]') :
                    file.name.endsWith('.c') ? (isDark ? 'text-[#519aba]' : 'text-[#005f87]') :
                    isDark ? 'text-[#a9dc76]' : 'text-[#22863a]'
                  }`}>
                    {file.name.endsWith('.l') ? '⚡' : file.name.endsWith('.c') ? '©' : '📄'}
                  </span>
                  <span className="truncate flex-1">{file.name}</span>
                  {file.modified && <span className="text-[#007acc] text-xs">●</span>}
                </div>
              ))}
              {files.length === 0 && (
                <div className={`text-xs px-4 py-4 text-center ${isDark ? 'text-[#858585]' : 'text-[#999999]'}`}>
                  No files yet. Use &quot;new&quot; in terminal or click +
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Editor + Terminal Area ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* ── Tab Bar ── */}
          <div className={`h-[35px] flex items-end shrink-0 ${
            isDark ? 'bg-[#252526]' : 'bg-[#ececec]'
          }`}>
            <div className="flex-1 flex items-end overflow-x-auto">
              {tabs.map(tab => {
                const isActive = activeTab === tab.fileId;
                const f = files.find(x => x.id === tab.fileId);
                return (
                  <div
                    key={tab.fileId}
                    onClick={() => setActiveTab(tab.fileId)}
                    onAuxClick={e => { if (e.button === 1) closeTab(tab.fileId); }}
                    className={`group flex items-center gap-2 px-3 h-[35px] text-[13px] cursor-pointer border-t-2 shrink-0 ${
                      isActive
                        ? isDark
                          ? 'bg-[#1e1e1e] text-white border-[#007acc]'
                          : 'bg-white text-black border-[#007acc]'
                        : isDark
                          ? 'bg-[#2d2d2d] text-[#969696] hover:bg-[#2d2d2d] border-transparent'
                          : 'bg-[#ececec] text-[#616161] hover:bg-[#dcdcdc] border-transparent'
                    }`}
                  >
                    <span className={`text-xs ${
                      tab.fileName.endsWith('.l') ? (isDark ? 'text-[#e8ab53]' : 'text-[#b8860b]') : ''
                    }`}>
                      {tab.fileName.endsWith('.l') ? '⚡' : '📄'}
                    </span>
                    <span>{tab.fileName}</span>
                    {f?.modified && <span className="text-[#007acc]">●</span>}
                    <button
                      onClick={e => closeTab(tab.fileId, e)}
                      className={`ml-1 p-0.5 rounded-sm opacity-0 group-hover:opacity-100 ${
                        isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Editor ── */}
          <div className="flex-1 overflow-hidden">
            {activeFile ? (
              <Editor
                height="100%"
                language={getLanguage(activeFile.name)}
                value={activeFile.content}
                path={activeFile.name}
                theme={isDark ? 'lex-dark' : 'lex-light'}
                beforeMount={handleEditorWillMount}
                onMount={handleEditorDidMount}
                onChange={handleEditorChange}
                loading={
                  <div className={`flex items-center justify-center h-full ${
                    isDark ? 'bg-[#1e1e1e] text-[#858585]' : 'bg-white text-[#999999]'
                  }`}>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-2 border-[#007acc] border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Loading editor...</span>
                    </div>
                  </div>
                }
                options={{
                  fontSize: 14,
                  fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                  fontLigatures: true,
                  minimap: { enabled: true, maxColumn: 80 },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 4,
                  wordWrap: 'off',
                  lineNumbers: 'on',
                  renderLineHighlight: 'line',
                  bracketPairColorization: { enabled: true },
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  smoothScrolling: true,
                  padding: { top: 8 },
                }}
              />
            ) : (
              <div className={`h-full flex flex-col items-center justify-center ${
                isDark ? 'bg-[#1e1e1e] text-[#858585]' : 'bg-white text-[#aaaaaa]'
              }`}>
                <div className="relative mb-6">
                  <div className="absolute inset-0 blur-2xl opacity-20 bg-[#007acc] rounded-full scale-150" />
                  <svg className="relative w-20 h-20 opacity-30" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M13.5 2L3 14h6.5L10 22l10.5-12H14L13.5 2z" />
                  </svg>
                </div>
                <p className="text-xl font-semibold mb-1 opacity-60">Lex Studio</p>
                <p className="text-sm mb-8 opacity-40">Select a file or create one to start editing</p>
                <div className={`rounded-lg p-4 text-xs space-y-1.5 font-mono opacity-40 ${
                  isDark ? 'bg-[#252526]' : 'bg-[#f5f5f5]'
                }`}>
                  <p><span className={isDark ? 'text-[#4ec9b0]' : 'text-[#22863a]'}>$</span> new scanner.l</p>
                  <p><span className={isDark ? 'text-[#4ec9b0]' : 'text-[#22863a]'}>$</span> lex scanner.l</p>
                  <p><span className={isDark ? 'text-[#4ec9b0]' : 'text-[#22863a]'}>$</span> gcc lex.yy.c -o scanner</p>
                  <p><span className={isDark ? 'text-[#4ec9b0]' : 'text-[#22863a]'}>$</span> ./scanner</p>
                </div>
                <div className="flex gap-6 mt-8 text-[11px] opacity-30">
                  <span>Ctrl+B &mdash; Sidebar</span>
                  <span>Ctrl+` &mdash; Terminal</span>
                  <span>Ctrl+S &mdash; Save</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Terminal Panel ── */}
          {terminalVisible && (
            <div className={`h-64 shrink-0 flex flex-col ${
              isDark ? 'bg-[#1e1e1e] border-[#3c3c3c]' : 'bg-white border-[#d4d4d4]'
            } border-t`}>
              {/* Terminal header */}
              <div className={`h-[30px] flex items-center justify-between px-3 shrink-0 ${
                isDark ? 'bg-[#252526] border-[#3c3c3c]' : 'bg-[#f3f3f3] border-[#d4d4d4]'
              } border-b`}>
                <div className="flex items-center gap-3">
                  <span className={`text-[11px] font-semibold uppercase tracking-wider ${
                    isDark ? 'text-[#cccccc]' : 'text-[#616161]'
                  }`}>Terminal</span>
                  {activeFile?.name.endsWith('.l') && (
                    <button
                      onClick={handleRunWithDialog}
                      className="px-2 py-0.5 text-[11px] rounded-sm bg-[#28a745] text-white hover:bg-[#22863a] transition-colors"
                    >
                      ▶ Run
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setTerminalLines([])}
                    className={`p-1 rounded-sm ${isDark ? 'hover:bg-white/10 text-[#858585]' : 'hover:bg-black/10 text-[#616161]'}`}
                    title="Clear Terminal"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setTerminalVisible(false)}
                    className={`p-1 rounded-sm ${isDark ? 'hover:bg-white/10 text-[#858585]' : 'hover:bg-black/10 text-[#616161]'}`}
                    title="Hide Terminal (Ctrl+`)"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Terminal content */}
              <div
                ref={terminalRef}
                className={`flex-1 overflow-y-auto p-2 text-[13px] leading-5 cursor-text ${
                  isDark ? 'bg-[#1e1e1e]' : 'bg-[#ffffff]'
                }`}
                style={{ fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace" }}
                onClick={() => {
                  if (inputMode) inputModeRef.current?.focus();
                  else terminalInputRef.current?.focus();
                }}
              >
                {terminalLines.map(line => (
                  <div
                    key={line.id}
                    className={
                      line.type === 'command' ? (isDark ? 'text-[#d4d4d4]' : 'text-[#333333]') :
                      line.type === 'error' ? 'text-[#f44747]' :
                      line.type === 'success' ? (isDark ? 'text-[#4ec9b0]' : 'text-[#22863a]') :
                      line.type === 'info' ? (isDark ? 'text-[#569cd6]' : 'text-[#0078d4]') :
                      line.type === 'input' ? (isDark ? 'text-[#ce9178]' : 'text-[#a31515]') :
                      isDark ? 'text-[#cccccc]' : 'text-[#333333]'
                    }
                    style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {line.content}
                  </div>
                ))}

                {/* Input mode prompt */}
                {inputMode && (
                  <div className="flex items-center">
                    <span className={isDark ? 'text-[#ce9178]' : 'text-[#a31515]'}>{'> '}</span>
                    <input
                      ref={inputModeRef}
                      type="text"
                      value={inputLineText}
                      onChange={e => setInputLineText(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      className="flex-1 bg-transparent border-none outline-none text-[13px]"
                      style={{
                        fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                        color: isDark ? '#d4d4d4' : '#333333',
                        caretColor: isDark ? '#d4d4d4' : '#333333',
                      }}
                      autoFocus
                    />
                  </div>
                )}

                {/* Command prompt */}
                {!inputMode && (
                  <div className="flex items-center">
                    <span className={isDark ? 'text-[#4ec9b0]' : 'text-[#22863a]'}>user@lexstudio</span>
                    <span className={isDark ? 'text-[#d4d4d4]' : 'text-[#333333]'}>:</span>
                    <span className={isDark ? 'text-[#569cd6]' : 'text-[#0078d4]'}>~</span>
                    <span className={isDark ? 'text-[#d4d4d4]' : 'text-[#333333]'}>$&nbsp;</span>
                    <input
                      ref={terminalInputRef}
                      type="text"
                      value={terminalInput}
                      onChange={e => setTerminalInput(e.target.value)}
                      onKeyDown={handleTerminalKeyDown}
                      className="flex-1 bg-transparent border-none outline-none text-[13px]"
                      style={{
                        fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                        color: isDark ? '#d4d4d4' : '#333333',
                        caretColor: isDark ? '#d4d4d4' : '#333333',
                      }}
                      spellCheck={false}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Status Bar ── */}
      <div className="h-[22px] flex items-center justify-between px-3 text-[11px] text-white bg-[#007acc] shrink-0">
        <div className="flex items-center gap-3">
          <span>⚡ Lex Studio</span>
          {activeFile && (
            <>
              <span>{activeFile.name}</span>
              {activeFile.modified && <span>● Modified</span>}
            </>
          )}
          {lexProgram && <span className="text-green-200">✓ Lexer Ready</span>}
          {compiledProgramName && <span className="text-yellow-200">⚙ {compiledProgramName}</span>}
          {backendAvailable
            ? <span className="text-green-200">● Server Connected</span>
            : <span className="text-red-200">○ Server Offline</span>
          }
        </div>
        <div className="flex items-center gap-4">
          {activeFile && (
            <>
              <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
              <span>{activeFile.content.split('\n').length} lines</span>
            </>
          )}
          <span>UTF-8</span>
          <span>{activeFile?.name.endsWith('.l') ? 'Lex' : activeFile?.name.endsWith('.c') ? 'C' : 'Plain Text'}</span>
          <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <div
          className={`fixed z-50 rounded-md shadow-xl py-1 min-w-[180px] ${
            isDark ? 'bg-[#3c3c3c] border-[#545454]' : 'bg-white border-[#cccccc]'
          } border`}
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={() => { const f = files.find(x => x.id === contextMenu.fileId); if (f) openFile(f.id); setContextMenu(null); }}
            className={`w-full px-3 py-1.5 text-[13px] text-left ${isDark ? 'text-[#cccccc] hover:bg-[#094771]' : 'text-[#333333] hover:bg-[#0078d4] hover:text-white'}`}
          >
            Open
          </button>
          <button
            onClick={() => {
              const f = files.find(x => x.id === contextMenu.fileId);
              if (f) { fileSystem.save({ ...f, modified: false }); setFiles(prev => prev.map(x => x.id === f.id ? { ...x, modified: false } : x)); addLine(`Saved: ${f.name}`, 'success'); }
              setContextMenu(null);
            }}
            className={`w-full px-3 py-1.5 text-[13px] text-left ${isDark ? 'text-[#cccccc] hover:bg-[#094771]' : 'text-[#333333] hover:bg-[#0078d4] hover:text-white'}`}
          >
            Save
          </button>
          <button
            onClick={() => {
              const f = files.find(x => x.id === contextMenu.fileId);
              if (f) { const n = prompt('New name:', f.name); if (n) renameFileById(f.id, n); }
              setContextMenu(null);
            }}
            className={`w-full px-3 py-1.5 text-[13px] text-left ${isDark ? 'text-[#cccccc] hover:bg-[#094771]' : 'text-[#333333] hover:bg-[#0078d4] hover:text-white'}`}
          >
            Rename…
          </button>
          <hr className={`my-1 ${isDark ? 'border-[#545454]' : 'border-[#d4d4d4]'}`} />
          <button
            onClick={() => deleteFileById(contextMenu.fileId)}
            className="w-full px-3 py-1.5 text-[13px] text-left text-[#f44747] hover:bg-[#f44747]/20"
          >
            Delete
          </button>
        </div>
      )}

      {/* ── New File Dialog (VS Code-style command palette) ── */}
      {showNewFileDialog && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
          onClick={() => { setShowNewFileDialog(false); setNewFileName(''); }}
        >
          <div
            className={`w-[500px] rounded-lg shadow-2xl overflow-hidden ${
              isDark ? 'bg-[#252526] border-[#3c3c3c]' : 'bg-white border-[#cccccc]'
            } border`}
            onClick={e => e.stopPropagation()}
          >
            <input
              type="text"
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  createFile(newFileName);
                  setShowNewFileDialog(false);
                  setNewFileName('');
                }
                if (e.key === 'Escape') {
                  setShowNewFileDialog(false);
                  setNewFileName('');
                }
              }}
              placeholder="Enter file name (e.g., scanner.l, notes.txt)"
              className={`w-full px-4 py-3 text-[14px] outline-none ${
                isDark ? 'bg-[#3c3c3c] text-white placeholder-[#858585]' : 'bg-white text-black placeholder-[#aaaaaa]'
              }`}
              autoFocus
            />
          </div>
        </div>
      )}

      {/* ── Input Dialog ── */}
      {showInputDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { setShowInputDialog(false); setCustomInput(''); }}
        >
          <div
            className={`w-[500px] rounded-lg shadow-2xl ${
              isDark ? 'bg-[#252526] border-[#3c3c3c]' : 'bg-white border-[#cccccc]'
            } border`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`px-4 py-3 text-sm font-semibold ${
              isDark ? 'text-white border-[#3c3c3c]' : 'text-black border-[#d4d4d4]'
            } border-b`}>
              Enter Input for Lexer
            </div>
            <div className="p-4">
              <textarea
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                placeholder="Enter text to tokenize..."
                rows={8}
                className={`w-full px-3 py-2 rounded text-[13px] outline-none resize-none ${
                  isDark
                    ? 'bg-[#3c3c3c] text-white placeholder-[#858585] border-[#545454]'
                    : 'bg-[#f3f3f3] text-black placeholder-[#aaaaaa] border-[#cccccc]'
                } border focus:border-[#007acc]`}
                style={{ fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace" }}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={() => { setShowInputDialog(false); setCustomInput(''); }}
                  className={`px-4 py-1.5 rounded text-[13px] ${isDark ? 'text-[#cccccc] hover:bg-white/10' : 'text-[#616161] hover:bg-black/10'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDialogRun}
                  className="px-4 py-1.5 rounded text-[13px] bg-[#007acc] text-white hover:bg-[#006bb3]"
                >
                  ▶ Run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
