/**
 * Autocomplete Input
 *
 * Real-time dropdown autocomplete for terminal input
 * No external dependencies - uses raw terminal control
 */

import * as readline from "readline";

export interface AutocompleteOption {
  value: string;
  label?: string;
}

export interface AutocompleteConfig {
  /** Function to get suggestions based on current input */
  getSuggestions: (input: string) => AutocompleteOption[];
  /** Prompt string */
  prompt?: string;
  /** Max suggestions to show */
  maxSuggestions?: number;
}

// ANSI escape codes
const ESC = "\x1b";
const CLEAR_LINE = `${ESC}[2K`;
const CURSOR_UP = (n: number) => `${ESC}[${n}A`;
const CURSOR_DOWN = (n: number) => `${ESC}[${n}B`;
const CURSOR_TO_COL = (n: number) => `${ESC}[${n}G`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const INVERSE = `${ESC}[7m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

/**
 * Read a line with real-time autocomplete dropdown
 */
export function autocompleteInput(config: AutocompleteConfig): Promise<string> {
  return new Promise((resolve) => {
    const { getSuggestions, prompt = "> ", maxSuggestions = 5 } = config;

    const stdin = process.stdin;
    const stdout = process.stdout;

    let input = "";
    let cursorPos = 0;
    let suggestions: AutocompleteOption[] = [];
    let selectedIndex = -1;
    let displayedLines = 0;

    // Enable raw mode
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(stdin);

    const cleanup = () => {
      clearSuggestions();
      stdout.write(SHOW_CURSOR);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
      stdin.removeListener("keypress", onKeypress);
    };

    const render = () => {
      // Clear previous suggestions
      clearSuggestions();

      // Render input line
      stdout.write(`\r${CLEAR_LINE}${prompt}${input}`);

      // Position cursor
      const cursorCol = prompt.length + cursorPos + 1;
      stdout.write(CURSOR_TO_COL(cursorCol));

      // Get and display suggestions if input starts with /
      if (input.startsWith("/") && input.length > 1) {
        suggestions = getSuggestions(input).slice(0, maxSuggestions);

        if (suggestions.length > 0) {
          // Ensure selectedIndex is valid
          if (selectedIndex >= suggestions.length) {
            selectedIndex = suggestions.length - 1;
          }

          stdout.write("\n");
          displayedLines = suggestions.length;

          for (let i = 0; i < suggestions.length; i++) {
            const opt = suggestions[i]!;
            const isSelected = i === selectedIndex;
            const prefix = isSelected ? `${INVERSE}` : `${DIM}`;
            const suffix = RESET;
            const label = opt.label ? ` ${DIM}${opt.label}${RESET}` : "";
            const line = `${prefix}  ${opt.value}${suffix}${label}`;

            stdout.write(`${CLEAR_LINE}${line}`);
            if (i < suggestions.length - 1) {
              stdout.write("\n");
            }
          }

          // Move cursor back up to input line
          if (displayedLines > 0) {
            stdout.write(CURSOR_UP(displayedLines));
          }
          stdout.write(CURSOR_TO_COL(cursorCol));
        }
      } else {
        suggestions = [];
        selectedIndex = -1;
      }
    };

    const clearSuggestions = () => {
      if (displayedLines > 0) {
        // Move down and clear each line
        for (let i = 0; i < displayedLines; i++) {
          stdout.write(`\n${CLEAR_LINE}`);
        }
        // Move back up
        stdout.write(CURSOR_UP(displayedLines));
        displayedLines = 0;
      }
    };

    const submit = (value: string) => {
      cleanup();
      stdout.write("\n");
      resolve(value);
    };

    const onKeypress = (_char: string, key: readline.Key) => {
      if (!key) return;

      // Handle Ctrl+C
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }

      // Handle Ctrl+D (EOF)
      if (key.ctrl && key.name === "d") {
        cleanup();
        stdout.write("\n");
        resolve("");
        return;
      }

      // Handle Enter
      if (key.name === "return" || key.name === "enter") {
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          // Use selected suggestion
          const selected = suggestions[selectedIndex]!;
          submit(selected.value);
        } else {
          submit(input);
        }
        return;
      }

      // Handle Tab - cycle through suggestions or complete selected one
      if (key.name === "tab") {
        if (suggestions.length > 0) {
          if (selectedIndex >= 0) {
            // Already have a selection - complete it to input
            const selected = suggestions[selectedIndex]!;
            input = selected.value + " ";
            cursorPos = input.length;
            selectedIndex = -1;
            render();
          } else {
            // No selection yet - select first item
            if (key.shift) {
              selectedIndex = suggestions.length - 1;
            } else {
              selectedIndex = 0;
            }
            render();
          }
        }
        return;
      }

      // Handle arrow keys
      if (key.name === "up") {
        if (suggestions.length > 0) {
          selectedIndex = selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1;
          render();
        }
        return;
      }

      if (key.name === "down") {
        if (suggestions.length > 0) {
          selectedIndex = selectedIndex >= suggestions.length - 1 ? 0 : selectedIndex + 1;
          render();
        }
        return;
      }

      // Handle Escape - clear selection
      if (key.name === "escape") {
        selectedIndex = -1;
        render();
        return;
      }

      // Handle backspace
      if (key.name === "backspace") {
        if (cursorPos > 0) {
          input = input.slice(0, cursorPos - 1) + input.slice(cursorPos);
          cursorPos--;
          selectedIndex = -1;
          render();
        }
        return;
      }

      // Handle delete
      if (key.name === "delete") {
        if (cursorPos < input.length) {
          input = input.slice(0, cursorPos) + input.slice(cursorPos + 1);
          selectedIndex = -1;
          render();
        }
        return;
      }

      // Handle left arrow
      if (key.name === "left") {
        if (cursorPos > 0) {
          cursorPos--;
          render();
        }
        return;
      }

      // Handle right arrow
      if (key.name === "right") {
        if (cursorPos < input.length) {
          cursorPos++;
          render();
        }
        return;
      }

      // Handle home
      if (key.name === "home" || (key.ctrl && key.name === "a")) {
        cursorPos = 0;
        render();
        return;
      }

      // Handle end
      if (key.name === "end" || (key.ctrl && key.name === "e")) {
        cursorPos = input.length;
        render();
        return;
      }

      // Handle printable characters
      if (key.sequence && !key.ctrl && !key.meta) {
        const char = key.sequence;
        if (char.length === 1 && char.charCodeAt(0) >= 32) {
          input = input.slice(0, cursorPos) + char + input.slice(cursorPos);
          cursorPos++;
          selectedIndex = -1;
          render();
        }
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}
