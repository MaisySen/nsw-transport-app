// Sentry crash reporting: the web build and type checks use this file; iPhone and Android use sentry.native.ts.
// The web export never loads @sentry/react-native, so every function here does nothing. docs/SENTRY.md.
import type { ComponentType } from 'react';

/** Starts Sentry once, only on a build with its native module. On the web: never. */
export function initSentry(): boolean { return false; }

/** True once Sentry is running on this phone. */
export function sentryActive(): boolean { return false; }

/** Sends one caught error (a screen's error boundary) to Sentry. */
export function captureToSentry(_error: unknown, _where: string): void {}

/** Wraps the root layout with Sentry on a build that has it; on any other build returns it unchanged. */
export function withSentry<P extends object>(C: ComponentType<P>): ComponentType<P> { return C; }
