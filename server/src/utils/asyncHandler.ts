import { Request, Response, NextFunction } from "express";

// Wraps an async route handler so any thrown error / rejected promise is
// forwarded to the central error middleware instead of becoming an unhandled
// rejection (which kills the whole Node process in Node 15+).
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
