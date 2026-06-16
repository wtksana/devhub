export interface TerminalTab {
  id: string;
  connectionId: string;
  title: string;
  status: "connecting" | "connected" | "disconnected" | "failed";
}
