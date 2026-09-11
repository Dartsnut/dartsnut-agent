declare global {
  interface HTMLElement {
    inert: boolean;
  }
}

declare module "react" {
  interface HTMLAttributes<T> {
    inert?: boolean;
  }
}

export {};
