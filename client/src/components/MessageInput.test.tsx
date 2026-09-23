import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MessageInput } from './MessageInput';

function setup(onSend = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(<MessageInput onSend={onSend} />);
  return {
    user,
    onSend,
    input: screen.getByRole('textbox', { name: 'Message' }),
    button: screen.getByRole('button', { name: 'Send' }),
  };
}

describe('MessageInput', () => {
  it('sends trimmed text on Enter and clears the input', async () => {
    const { user, onSend, input } = setup();

    await user.type(input, '  hello  {Enter}');

    expect(onSend).toHaveBeenCalledWith('hello');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('does not send empty or whitespace-only text', async () => {
    const { user, onSend, input, button } = setup();

    expect(button).toBeDisabled();
    await user.type(input, '   {Enter}');

    expect(button).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the text and shows the error when sending fails', async () => {
    const onSend = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('Server said no'));
    const { user, input } = setup(onSend);

    await user.type(input, 'hello{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Server said no');
    expect(input).toHaveValue('hello');
  });

  it('sends only once on rapid double submit', async () => {
    const onSend = vi.fn<(text: string) => Promise<void>>(() => new Promise(() => {}));
    const { user, input, button } = setup(onSend);

    await user.type(input, 'hi{Enter}{Enter}');
    await user.click(button);

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('shows a character counter and limits input to 500 characters', async () => {
    const { user, input } = setup();

    await user.type(input, 'hello');

    expect(screen.getByText('5/500')).toBeInTheDocument();
    expect(input).toHaveAttribute('maxLength', '500');
  });
});
