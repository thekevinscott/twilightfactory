import { type Inputs, type State, state } from "./state.js";

export const twilightStateMachine = <Args extends unknown[]>(inputs: Inputs<Args>, ...args: Args): Promise<State> =>
  state(inputs, args);
