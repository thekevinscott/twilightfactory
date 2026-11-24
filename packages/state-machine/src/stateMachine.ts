import { Stop } from "./stop.js";

export type Action<Args extends unknown[]> = ((...args: Args) => Promise<void>) | typeof Stop;

export const stateMachine = async <Args extends unknown[]>(
  state: (...args: Args) => Promise<string>,
  actions: Record<string, Action<Args>>,
  ...args: Args
): Promise<void> => {
  while (true) {
    const name = await state(...args);
    if (!Object.hasOwn(actions, name)) {
      throw new Error(`unknown state: ${name}`);
    }
    const action = actions[name]!;
    if (typeof action !== "function") {
      return;
    }
    await action(...args);
  }
};
