export { UnoverseComponent } from "./UnoverseComponent";
export type { UnoverseComponentProps } from "./UnoverseComponent";
export { StreamedUnoverseComponent, useUnoverseInstance } from "./streamed";
export type { StreamedUnoverseComponentProps } from "./streamed";
export { StreamedUnoverseTemplate, selectPointers } from "./template";
export type { StreamedUnoverseTemplateProps } from "./template";
export { renderNode, styleToCss, keyframesCss } from "./render";
export type { ActionHandler, SlotResolver } from "./render";
export { useUnoverseTheme } from "./theme";
export { IsolatedRoot } from "./isolate";
export { useUnoverseConnection } from "./connection";
export type { UnoverseConnectionConfig, UnoverseSessionParams, UnoverseConnection } from "./connection";
// The `voice` native service (UNOVERSE_SPEC §2e-1 Tier-3). Channel-instantiated; its
// neutral state is spread into a `service: "voice"` template's scope, its actions
// dispatched from the template. Audio rides the /ws/gravity WS lane (§5), not MCP.
export { useVoiceService } from "./voice";
export type { UseVoiceServiceConfig, VoiceService, VoiceServiceState, VoiceSession, VoiceConnectionStatus } from "./voice";
// The theme SHAPE only. The SDK ships NO token values — fetch them from the
// server (client.readTheme / useUnoverseTheme). See UNOVERSE_SPEC §2d-1.
export type { ResolvedTheme } from "@gravity-platform/unoverse-core";
