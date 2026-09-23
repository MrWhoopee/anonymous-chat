import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAnonymousAuth: vi.fn(),
  useMessages: vi.fn(),
}));

vi.mock('../hooks/useAnonymousAuth', () => ({ useAnonymousAuth: mocks.useAnonymousAuth }));
vi.mock('../hooks/useMessages', () => ({ useMessages: mocks.useMessages }));
vi.mock('../lib/api', () => ({ sendMessage: vi.fn() }));

import { ChatRoom } from './ChatRoom';

const retry = vi.fn();

function authState(overrides: Record<string, unknown> = {}) {
  return { user: null, loading: false, error: null, retry, ...overrides };
}

describe('ChatRoom', () => {
  beforeEach(() => {
    retry.mockReset();
    mocks.useMessages.mockReturnValue({ messages: [], error: null });
  });

  it('shows "Connecting…" while signing in', () => {
    mocks.useAnonymousAuth.mockReturnValue(authState({ loading: true }));

    render(<ChatRoom />);

    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(mocks.useMessages).toHaveBeenCalledWith(false);
  });

  it('shows a retry screen when sign-in fails', async () => {
    mocks.useAnonymousAuth.mockReturnValue(authState({ error: new Error('boom') }));

    render(<ChatRoom />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText("Couldn't connect")).toBeInTheDocument();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders messages, "You" label and own id when signed in', () => {
    mocks.useAnonymousAuth.mockReturnValue(authState({ user: { uid: 'me-uid' } }));
    mocks.useMessages.mockReturnValue({
      messages: [
        { id: '1', text: 'from me', uid: 'me-uid', createdAt: null },
        { id: '2', text: 'from other', uid: 'other-uid', createdAt: null },
      ],
      error: null,
    });

    render(<ChatRoom />);

    expect(mocks.useMessages).toHaveBeenCalledWith(true);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('other-uid')).toBeInTheDocument();
    expect(screen.getByText(/Your ID:/)).toHaveTextContent('Your ID: me-uid');
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('shows a banner when the messages subscription fails', () => {
    mocks.useAnonymousAuth.mockReturnValue(authState({ user: { uid: 'me-uid' } }));
    mocks.useMessages.mockReturnValue({ messages: [], error: new Error('permission-denied') });

    render(<ChatRoom />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load messages");
  });
});
