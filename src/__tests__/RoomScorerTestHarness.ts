import { fireEvent, screen, within } from '@testing-library/react';

export interface ILocalStorageHarness {
  setFailWrites: (failWrites: boolean) => void;
}

export function installLocalStorage(
  failWrites = false,
  initialStore: Record<string, string> = {},
): ILocalStorageHarness {
  let store: Record<string, string> = { ...initialStore };
  let shouldFailWrites = failWrites;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        if (shouldFailWrites) throw new Error('QuotaExceededError');
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    },
  });
  return {
    setFailWrites: (next) => {
      shouldFailWrites = next;
    },
  };
}

export function installDialogMethods() {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}

export function chooseStarters(names: string[]) {
  const prompt = screen.getByLabelText('Starting lineups');
  for (const name of names) fireEvent.click(within(prompt).getByLabelText(name));
  fireEvent.click(within(prompt).getByText('Start game'));
}
