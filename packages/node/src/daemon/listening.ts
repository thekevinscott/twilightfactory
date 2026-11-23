import { connect } from "node:net";

export function listening(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const done = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(1000, () => done(true));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
