import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastHost } from "./ToastHost";

const toasterMock = vi.fn();

vi.mock("sonner", () => {
  return {
    Toaster: (props: unknown) => {
      toasterMock(props);
      return null;
    },
  };
});

describe("ToastHost", () => {
  it("configures the toaster", () => {
    render(<ToastHost />);
    expect(toasterMock).toHaveBeenCalled();
    const props = toasterMock.mock.calls[0]?.[0] as {
      position?: string;
      mobileOffset?: { top?: number };
    };
    expect(props.position).toBe("top-right");
    expect(props.mobileOffset?.top).toBe(112);
  });
});
