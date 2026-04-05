# Lex Studio - VS Code Style Lex IDE

## Concept & Vision
A professional-grade Lex programming IDE with a VS Code-like interface featuring a complete file system with backend persistence, interactive terminal, and dual light/dark themes. The experience mirrors real Linux development workflows where users manually execute each command.

## Design Language

### Aesthetic Direction
VS Code-inspired interface with monospace terminal aesthetics. Professional developer tool feel.

### Color Palette
**Dark Theme:**
- Background: `#1e1e1e` (editor), `#252526` (sidebar), `#333333` (terminal)
- Text: `#d4d4d4` (primary), `#858585` (secondary)
- Accent: `#007acc` (blue), `#4ec9b0` (teal for keywords)
- Syntax: `#ce9178` (strings), `#569cd6` (keywords), `#c586c0` (macros)

**Light Theme:**
- Background: `#ffffff` (editor), `#f3f3f3` (sidebar), `#f5f5f5` (terminal)
- Text: `#333333` (primary), `#616161` (secondary)
- Accent: `#0078d4` (blue)
- Syntax: `#a31515` (strings), `#0000ff` (keywords), `#af00db` (macros)

### Typography
- Code: `'Fira Code', 'Cascadia Code', 'Consolas', monospace`
- UI: `'Segoe UI', -apple-system, sans-serif`

### Motion
- Theme toggle: 200ms transition on all colors
- Panel resize: smooth drag
- Terminal scroll: smooth auto-scroll on new output

## Layout & Structure

### Main Layout
```
┌─────────────────────────────────────────────────────┐
│ Title Bar (draggable) │ Theme Toggle │ Min/Max/Close│
├─────────────────────────────────────────────────────┤
│ Menu Bar: File | Edit | View | Run | Help           │
├────────┬────────────────────────────────────────────┤
│ File   │ Tab1 │ Tab2 │ Tab3 │                       │
│ Explor│├────────────────────────────────────────────┤
│ er    ││                                            │
│        ││        Monaco Editor                       │
│ [files││                                            │
│  list] ││                                            │
│        │├────────────────────────────────────────────┤
│ [+New] ││ Terminal Panel                            │
│        ││ $ user@lexstudio:~$                        │
│        ││ [command input]                           │
│        ││ [output area]                             │
├────────┴────────────────────────────────────────────┤
│ Status: Lex | UTF-8 | Ln 1, Col 1 | Files: 3        │
└─────────────────────────────────────────────────────┘
```

## Features & Interactions

### File System (IndexedDB Backend)
- **Create**: Right-click → New File, or `new <filename>` command
- **Open**: Click file in explorer, or `open <filename>` command
- **Save**: Ctrl+S, or `save` command, auto-save on blur
- **Delete**: Right-click → Delete, or `rm <filename>` command
- **Rename**: Right-click → Rename
- Files persist across browser sessions
- Dirty indicator (*) for unsaved changes

### Terminal Commands
```
new <filename>     - Create new file
open <filename>    - Open file in editor
save [filename]    - Save current file
rm <filename>      - Delete file
ls                 - List files
cat <file>         - Display file content
rename <old> <new> - Rename file

lex <file.l>       - Lex compiler simulation
gcc <files> -o <x> - GCC compilation simulation
./<program>        - Run compiled program
clear              - Clear terminal
help               - Show help
```

### Lex Execution Flow
1. User writes code in editor
2. User saves with `save filename.l`
3. User types `lex filename.l` → generates lex.yy.c
4. User types `gcc lex.yy.c -o prog` → compiles
5. User types `./prog` → runs, prompts for input
6. User enters input line by line
7. Output displayed based on Lex rules

### Theme Toggle
- Sun/Moon icon in title bar
- Smooth 200ms transition
- Persisted in localStorage

## Component Inventory

### TitleBar
- App icon and name
- Theme toggle button (sun/moon)
- Window controls (decorative)

### MenuBar
- Dropdown menus with keyboard shortcuts
- File: New, Open, Save, Save All, Exit
- Edit: Undo, Redo, Cut, Copy, Paste
- View: Toggle Sidebar, Toggle Terminal
- Run: Lex Compile, GCC Build, Run Program
- Help: Commands, About

### FileExplorer
- File tree with icons
- Right-click context menu
- New file button
- File type icons (.l for Lex, .txt for text)

### EditorTabs
- Tab with filename and close button
- Modified indicator (*)
- Active tab highlight
- Middle-click to close

### MonacoEditor
- Full syntax highlighting for C/Lex
- Line numbers, minimap, bracket matching
- Auto-indent, word wrap option

### Terminal
- Output area (scrollable, selectable)
- Command input with prompt
- Input dialog for program input
- Command history (up/down arrows)
- Clear button

### StatusBar
- Current language mode
- Encoding (UTF-8)
- Cursor position (Ln, Col)
- File count

## Technical Approach

### Frontend Stack
- React 19 + TypeScript
- Tailwind CSS for styling
- Monaco Editor for code editing
- IndexedDB (via idb-keyval) for file persistence
- Custom Lex interpreter in TypeScript

### Data Model
```typescript
interface File {
  name: string;
  content: string;
  language: 'lex' | 'text';
  createdAt: number;
  updatedAt: number;
}

interface TerminalLine {
  type: 'command' | 'output' | 'error' | 'input';
  content: string;
  timestamp: number;
}
```

### State Management
- React useState/useReducer for UI state
- IndexedDB for file persistence
- localStorage for preferences (theme)
