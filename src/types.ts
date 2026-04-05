export interface LexFile {
  id: string;
  name: string;
  content: string;
  modified: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TerminalLine {
  id: string;
  type: 'command' | 'output' | 'error' | 'success' | 'info' | 'input';
  content: string;
  timestamp: number;
}

export interface EditorTab {
  fileId: string;
  fileName: string;
}

export interface LexToken {
  type: string;
  value: string;
  line: number;
}

export interface LexPattern {
  pattern: string;
  action: string;
  line: number;
}
