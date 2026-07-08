/**
 * QuickAddEvent — natural-language capture wiring.
 *
 * Level: component. Renders the real component inside ToastProvider with an
 * injected `today` (deterministic, no clock read) and a spied onCreateEvent.
 * The parser's own correctness is covered exhaustively by nlEventParser.test.ts;
 * here we pin the GLUE: preview shows the parse, submit forwards exactly the
 * parsed {title, description:'', date, tag} to the create path, and the control
 * is disabled when there's nothing to create.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { QuickAddEvent } from './QuickAddEvent';

// Wed 2026-07-08 (local parts) — injected so the component reads no clock.
const TODAY = { year: 2026, month: 6, day: 8 };

function renderQuickAdd(onCreateEvent = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ToastProvider>
      <QuickAddEvent today={TODAY} onCreateEvent={onCreateEvent} />
    </ToastProvider>,
  );
  const input = screen.getByLabelText('Quick add') as HTMLInputElement;
  const addButton = screen.getByRole('button', { name: 'Add' });
  return { input, addButton, onCreateEvent };
}

describe('QuickAddEvent', () => {
  it('shows a live preview (title + category) as the user types', () => {
    const { input } = renderQuickAdd();
    fireEvent.change(input, { target: { value: 'Soccer practice next Friday' } });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Soccer practice');
    expect(status).toHaveTextContent('Sports'); // sports keyword → Sports tag
  });

  it('forwards exactly the parsed {title, description, date, tag} to onCreateEvent', async () => {
    const { input, addButton, onCreateEvent } = renderQuickAdd();
    fireEvent.change(input, { target: { value: 'Soccer practice next Friday' } });
    fireEvent.click(addButton);

    await waitFor(() => expect(onCreateEvent).toHaveBeenCalledTimes(1));
    expect(onCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Soccer practice',
        description: '',
        tag: 'sports',
        // A Friday in July 2026, stored at UTC-noon (the app's isoForDay convention).
        date: expect.stringMatching(/^2026-07-\d\dT12:00:00/),
      }),
    );
  });

  it('clears the field after a successful create', async () => {
    const { input, addButton } = renderQuickAdd();
    fireEvent.change(input, { target: { value: 'Dentist tomorrow' } });
    fireEvent.click(addButton);
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('with no date phrase, flags "assumed today" and still creates (for today)', async () => {
    const { input, addButton, onCreateEvent } = renderQuickAdd();
    fireEvent.change(input, { target: { value: 'Buy milk' } });
    expect(screen.getByRole('status')).toHaveTextContent(/assumed today/i);
    fireEvent.click(addButton);
    await waitFor(() => expect(onCreateEvent).toHaveBeenCalledTimes(1));
    expect(onCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ date: expect.stringMatching(/^2026-07-08T12:00:00/) }),
    );
  });

  it('disables Add and creates nothing when the input is only a date', () => {
    const { input, addButton, onCreateEvent } = renderQuickAdd();
    fireEvent.change(input, { target: { value: 'tomorrow' } }); // no title → parser returns null
    expect(addButton).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(addButton);
    expect(onCreateEvent).not.toHaveBeenCalled();
  });

  it('disables Add when the input is empty', () => {
    const { addButton } = renderQuickAdd();
    expect(addButton).toHaveAttribute('aria-disabled', 'true');
  });
});
