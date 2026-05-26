import { render, screen } from '@testing-library/react';
import App from './App';

// Sample passing test so the test runner is wired and `npm test` is green.
// Real feature/primitive tests come from the test-writer in later phases.
describe('App shell', () => {
  it('renders the Family HQ heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /family hq/i })).toBeInTheDocument();
  });
});
