import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { MessageItem } from './MessageItem';

const base: Message = {
  id: 'm1',
  text: 'hello there',
  uid: 'author-uid-123',
  createdAt: new Date('2026-09-23T10:15:00'),
};

describe('MessageItem', () => {
  it('labels own messages as "You" instead of the uid', () => {
    render(<MessageItem message={base} currentUid="author-uid-123" />);

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('author-uid-123')).not.toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveClass('message--own');
  });

  it("shows the author's uid for other people's messages", () => {
    render(<MessageItem message={base} currentUid="someone-else" />);

    expect(screen.getByText('author-uid-123')).toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
    expect(screen.getByRole('listitem')).not.toHaveClass('message--own');
  });

  it('renders the text and time', () => {
    const { container } = render(<MessageItem message={base} currentUid="x" />);

    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('dateTime', base.createdAt!.toISOString());
  });

  it('renders without a time when createdAt is null', () => {
    const { container } = render(<MessageItem message={{ ...base, createdAt: null }} currentUid="x" />);

    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(container.querySelector('time')).toBeNull();
  });
});
