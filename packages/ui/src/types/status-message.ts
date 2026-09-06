export type StatusTone = "info" | "success" | "warning" | "error";

export type StatusMessageProps = {
  tone: StatusTone;
  message: string;
  className?: string;
  testID?: string;
};
