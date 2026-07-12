import {
  fireEvent,
  render,
  screen,
} from "@excalidraw/excalidraw/tests/test-utils";

import ExcalidrawApp from "../App";

describe("AppMainMenu", () => {
  beforeEach(async () => {
    window.location.hash = "";
    await render(<ExcalidrawApp />);
  });

  it("navigates back to the dashboard", () => {
    window.location.hash = "#/d/Folder/Diagram.excalidraw";

    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    fireEvent.click(screen.getByText("Back to dashboard"));

    expect(window.location.hash).toBe("#/");
  });
});
