import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/components/layout/PanelLayout", () => {
  return {
    PanelLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    PanelHeader: ({ title }: { title: string }) => <div>{title}</div>,
    PanelBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/features/competition/components/Leaderboard", () => {
  return {
    Leaderboard: () => <div>Leaderboard</div>,
  };
});

import LeaderboardRoute from "./-leaderboard.lazy";

describe("Leaderboard route", () => {
  it("renders leaderboard panel", () => {
    render(<LeaderboardRoute />);
    expect(screen.getAllByText("Leaderboard").length).toBeGreaterThan(0);
  });
});
