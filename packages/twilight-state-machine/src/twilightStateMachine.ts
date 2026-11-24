import { type Action, stateMachine } from "twilightfactory-state-machine";
import { type Inputs, type State, state } from "./state.js";

export const twilightStateMachine = async <Args extends unknown[]>(
  inputs: Inputs<Args>,
  actions: Record<State, Action<Args>>,
  ...args: Args
): Promise<void> => stateMachine((...args: Args) => state(inputs, args), actions, ...args);
