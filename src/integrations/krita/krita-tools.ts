import type { DesktopCaptureFrame } from "../desktop/desktop-capture.js";
import { KritaActions, type KritaBatchOperation, type KritaInputOptions, type KritaNormalizedRegion, type KritaPathPoint } from "./krita-actions.js";
import type { KritaCanvasRegion, KritaNormalizedPoint } from "./krita-calibration.js";
import type { KritaShortcutCommand } from "./krita-shortcuts.js";
import type { KritaStateValue, KritaTrackedStateField } from "./krita-state.js";
import type { KritaUiRegionName, KritaUiTargetInput } from "./krita-ui-targets.js";
import type { KritaTransactionRequest } from "./krita-transactions.js";

export class KritaTools {
  private readonly actions: KritaActions;

  constructor(actions?: KritaActions, options: { shortcutStateDir?: string; checkpointStateDir?: string } = {}) {
    // Existing embedders/tests can inject an action object; the server passes a
    // private state directory to make shortcut validation restart-safe.
    this.actions = actions ?? new KritaActions(undefined, options);
  }

  async status(workspaceId: string): Promise<Record<string, unknown>> {
    return this.actions.status(workspaceId);
  }

  getState(workspaceId: string) {
    return this.actions.getState(workspaceId);
  }

  async getCanvasInfo(workspaceId: string): Promise<Record<string, unknown>> {
    const calibration = await this.actions.checkCalibration(workspaceId);
    return {
      mode: "no-plugin-desktop",
      pluginRequired: false,
      calibration,
      expectedState: this.actions.getState(workspaceId),
    };
  }

  async getCanvas(
    workspaceId: string,
    input: { maxWidth?: number; quality?: number; normalizedRegion?: KritaNormalizedRegion },
  ): Promise<DesktopCaptureFrame> {
    return this.actions.captureCanvas(workspaceId, input);
  }

  async calibrate(workspaceId: string, canvasWindowRegion: KritaCanvasRegion) {
    return this.actions.calibrate(workspaceId, canvasWindowRegion);
  }

  async autoCalibrate(workspaceId: string) {
    return this.actions.autoCalibrate(workspaceId);
  }

  getCalibration(workspaceId: string) {
    return this.actions.getCalibration(workspaceId);
  }

  async checkCalibration(workspaceId: string) {
    return this.actions.checkCalibration(workspaceId);
  }

  clearCalibration(workspaceId: string) {
    return this.actions.clearCalibration(workspaceId);
  }

  verifyCalibration(workspaceId: string) {
    return this.actions.verifyCalibration(workspaceId);
  }

  getShortcuts(workspaceId: string) {
    return this.actions.getShortcuts(workspaceId);
  }

  getRecommendedShortcuts() {
    return this.actions.getRecommendedShortcuts();
  }

  async prepareShortcuts(workspaceId: string) {
    return this.actions.prepareShortcuts(workspaceId);
  }

  async getWindow(workspaceId: string) {
    return this.actions.getWindow(workspaceId);
  }

  async getWindowCapture(workspaceId: string, input: { maxWidth?: number; quality?: number } = {}) {
    return this.actions.captureWindow(workspaceId, input);
  }

  async registerUiTarget(workspaceId: string, input: KritaUiTargetInput) {
    return this.actions.registerUiTarget(workspaceId, input);
  }

  async listUiTargets(workspaceId: string) {
    return this.actions.listUiTargets(workspaceId);
  }

  async refreshUiTargets(workspaceId: string, inputs: KritaUiTargetInput[] = []) {
    return this.actions.refreshUiTargets(workspaceId, inputs);
  }

  async getUiRegion(workspaceId: string, region: KritaUiRegionName, input: { targetId?: string; maxWidth?: number; quality?: number } = {}) {
    return this.actions.captureUiRegion(workspaceId, region, input);
  }

  async getDialogState(workspaceId: string) {
    return this.actions.getDialogState(workspaceId);
  }

  async listDialogSubtargets(workspaceId: string) {
    return this.actions.listDialogSubtargets(workspaceId);
  }

  async captureDialog(workspaceId: string) {
    return this.actions.captureDialog(workspaceId);
  }

  async dialogDecision(workspaceId: string, decision: "confirm" | "cancel", options: KritaInputOptions = {}) {
    return this.actions.dialogDecision(workspaceId, decision, options);
  }

  async setDialogText(workspaceId: string, field: "filename" | "path", value: string, options: KritaInputOptions = {}) {
    return this.actions.setDialogText(workspaceId, field, value, options);
  }

  async locateBrushSizeControl(workspaceId: string, input?: { windowRegion: KritaCanvasRegion; confidence: number }) {
    return this.actions.locateBrushSizeControl(workspaceId, input);
  }

  async getBrushSize(workspaceId: string) {
    return this.actions.getBrushSize(workspaceId);
  }

  async setBrushSize(workspaceId: string, brushSize: number, options: KritaInputOptions = {}) {
    return this.actions.setBrushSize(workspaceId, brushSize, options);
  }

  async getForegroundColor(workspaceId: string) {
    return this.actions.getForegroundColor(workspaceId);
  }

  async setForegroundColor(workspaceId: string, color: string, options: KritaInputOptions = {}) {
    return this.actions.setForegroundColor(workspaceId, color, options);
  }

  async sampleColorAtPoint(workspaceId: string, point: KritaNormalizedPoint) {
    return this.actions.sampleColorAtPoint(workspaceId, point);
  }

  async swapForegroundBackground(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.swapForegroundBackground(workspaceId, options);
  }

  async resetForegroundBackground(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.resetForegroundBackground(workspaceId, options);
  }

  listApprovedBrushes() {
    return this.actions.listApprovedBrushes();
  }

  async setBrush(workspaceId: string, brushPreset: string, options: KritaInputOptions = {}) {
    return this.actions.setBrush(workspaceId, brushPreset, options);
  }

  async setApprovedBrush(workspaceId: string, id: string, options: KritaInputOptions = {}) {
    return this.actions.setApprovedBrush(workspaceId, id, options);
  }

  async listActions(workspaceId: string) {
    const calibrationValid = await this.readCalibrationValidity(workspaceId);
    try { await this.actions.listUiTargets(workspaceId); } catch { /* keep a conservative no-target catalog while Krita is offline */ }
    return this.actions.listActions(workspaceId, calibrationValid);
  }

  async searchActions(query: string, workspaceId: string) {
    const calibrationValid = await this.readCalibrationValidity(workspaceId);
    try { await this.actions.listUiTargets(workspaceId); } catch { /* keep a conservative no-target catalog while Krita is offline */ }
    return this.actions.searchActions(query, workspaceId, calibrationValid);
  }

  private async readCalibrationValidity(workspaceId: string): Promise<boolean> {
    try {
      const check = await this.actions.checkCalibration(workspaceId);
      return check.valid === true && typeof check.calibration?.verifiedAt === "string";
    } catch {
      // Action discovery remains useful while Krita is offline; readiness will
      // conservatively retain the verified_calibration blocker.
      return false;
    }
  }

  async triggerAction(workspaceId: string, actionId: string, options: KritaInputOptions = {}) {
    return this.actions.triggerAction(workspaceId, actionId, options);
  }

  async createLayer(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.createLayer(workspaceId, options);
  }

  async deleteLayer(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.deleteLayer(workspaceId, options);
  }

  async duplicateLayer(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.duplicateLayer(workspaceId, options);
  }

  async selectLayer(workspaceId: string, layerName: string, options: KritaInputOptions = {}) { return this.actions.selectLayer(workspaceId, layerName, options); }
  async setLayer(workspaceId: string, layerName: string, options: KritaInputOptions = {}) { return this.actions.setLayer(workspaceId, layerName, options); }
  async renameActiveLayer(workspaceId: string, name: string, options: KritaInputOptions = {}) { return this.actions.renameActiveLayer(workspaceId, name, options); }
  async moveLayerUp(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.moveLayerUp(workspaceId, options); }
  async moveLayerDown(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.moveLayerDown(workspaceId, options); }
  async toggleLayerVisibility(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.toggleLayerVisibility(workspaceId, options); }
  async toggleLayerLock(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.toggleLayerLock(workspaceId, options); }
  async selectPreviousLayer(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.selectPreviousLayer(workspaceId, options); }
  async selectNextLayer(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.selectNextLayer(workspaceId, options); }
  async pickLayerAtPoint(workspaceId: string, point: KritaNormalizedPoint, options: KritaInputOptions = {}) { return this.actions.pickLayerAtPoint(workspaceId, point, options); }
  async getLayersPanel(workspaceId: string, input: { targetId?: string; maxWidth?: number; quality?: number } = {}) { return this.actions.getLayersPanel(workspaceId, input); }
  async getActiveLayerVisual(workspaceId: string, input: { targetId?: string; maxWidth?: number; quality?: number } = {}) { return this.actions.getActiveLayerVisual(workspaceId, input); }
  async selectAll(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.selectAll(workspaceId, options); }
  async invertSelection(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.invertSelection(workspaceId, options); }
  async deselect(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.deselect(workspaceId, options); }
  async transformBegin(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.transformBegin(workspaceId, options); }
  async transformNudge(workspaceId: string, direction: "left" | "right" | "up" | "down", steps: number, options: KritaInputOptions = {}) { return this.actions.transformNudge(workspaceId, direction, steps, options); }
  async transformCommit(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.transformCommit(workspaceId, options); }
  async transformCancel(workspaceId: string, options: KritaInputOptions = {}) { return this.actions.transformCancel(workspaceId, options); }
  async getViewState(workspaceId: string) { return this.actions.getViewState(workspaceId); }
  async readinessReport(workspaceId: string) { return this.actions.readinessReport(workspaceId); }
  async checkpoint(workspaceId: string, options: { documentPath?: string; approveUnsavedLocation?: boolean } = {}) { return this.actions.checkpoint(workspaceId, options); }
  listCheckpoints(workspaceId: string) { return this.actions.listCheckpoints(workspaceId); }
  async captureCheckpointImage(workspaceId: string, checkpointId: string) { return this.actions.captureCheckpointImage(workspaceId, checkpointId); }
  async compareCanvas(workspaceId: string, checkpointId: string) { return this.actions.compareCanvas(workspaceId, checkpointId); }
  async restoreCheckpoint(workspaceId: string, checkpointId: string, options: { approveOverwrite?: boolean } = {}) { return this.actions.restoreCheckpoint(workspaceId, checkpointId, options); }
  async executeTransaction(workspaceId: string, request: KritaTransactionRequest) { return this.actions.executeTransaction(workspaceId, request); }

  async exportDocument(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.exportDocument(workspaceId, options);
  }

  async fill(workspaceId: string, point: KritaNormalizedPoint, options: KritaInputOptions = {}) {
    return this.actions.fill(workspaceId, point, options);
  }

  async select(
    workspaceId: string,
    shape: "rectangle" | "ellipse",
    start: KritaNormalizedPoint,
    end: KritaNormalizedPoint,
    options: KritaInputOptions = {},
  ) {
    return this.actions.select(workspaceId, shape, start, end, options);
  }

  async batch(workspaceId: string, operations: KritaBatchOperation[], options: KritaInputOptions = {}) {
    return this.actions.batch(workspaceId, operations, options);
  }

  setShortcut(workspaceId: string, command: KritaShortcutCommand, keys: string[]) {
    return this.actions.setShortcut(workspaceId, command, keys);
  }

  resetShortcut(workspaceId: string, command: KritaShortcutCommand) {
    return this.actions.resetShortcut(workspaceId, command);
  }

  validateShortcuts(workspaceId: string, commands: KritaShortcutCommand[] = [], probeIds: string[] = []) {
    return this.actions.validateShortcuts(workspaceId, commands, probeIds);
  }

  async probeShortcut(
    workspaceId: string,
    command: KritaShortcutCommand,
    options: { confirmReversible: boolean } & KritaInputOptions,
  ) {
    return this.actions.probeShortcut(workspaceId, command, options);
  }

  unvalidateShortcuts(workspaceId: string, commands: KritaShortcutCommand[]) {
    return this.actions.unvalidateShortcuts(workspaceId, commands);
  }

  async command(
    workspaceId: string,
    command: KritaShortcutCommand,
    options: { allowUnvalidated?: boolean } & KritaInputOptions = {},
  ) {
    return this.actions.command(workspaceId, command, options);
  }

  async undo(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.command(workspaceId, "undo", options);
  }

  async redo(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.command(workspaceId, "redo", options);
  }

  async save(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.saveDocument(workspaceId, options);
  }

  async saveAs(workspaceId: string, path: string, overwritePolicy: "allow" | "deny" = "deny", options: KritaInputOptions = {}) { return this.actions.saveAs(workspaceId, path, overwritePolicy, options); }
  async exportTo(workspaceId: string, path: string, format: string, overwritePolicy: "allow" | "deny" = "deny", options: KritaInputOptions = {}) { return this.actions.exportTo(workspaceId, path, format, overwritePolicy, options); }

  setExpectedState(
    workspaceId: string,
    patch: Partial<Record<KritaTrackedStateField, KritaStateValue>>,
    source?: string,
  ) {
    return this.actions.setExpectedState(workspaceId, patch, source);
  }

  markStateUnknown(workspaceId: string, fields: KritaTrackedStateField[], source?: string) {
    return this.actions.markStateUnknown(workspaceId, fields, source);
  }

  verifyState(workspaceId: string, fields: KritaTrackedStateField[], source?: string) {
    return this.actions.verifyState(workspaceId, fields, source);
  }

  resetState(workspaceId: string) {
    return this.actions.resetState(workspaceId);
  }

  async canvasClick(
    workspaceId: string,
    point: KritaNormalizedPoint,
    options: { button?: "left" | "right" | "middle"; clickCount?: number } & KritaInputOptions = {},
  ) {
    return this.actions.canvasClick(workspaceId, point, options);
  }

  async stroke(
    workspaceId: string,
    start: KritaNormalizedPoint,
    end: KritaNormalizedPoint,
    options: { durationMs?: number; button?: "left" | "right" | "middle" } & KritaInputOptions = {},
  ) {
    return this.actions.stroke(workspaceId, start, end, options);
  }

  async pathStroke(workspaceId: string, points: KritaPathPoint[], button?: "left" | "right" | "middle", options: KritaInputOptions = {}) {
    return this.actions.pathStroke(workspaceId, points, { button, focusPolicy: options.focusPolicy });
  }

  async pan(workspaceId: string, points: KritaPathPoint[], options: KritaInputOptions = {}) {
    return this.actions.pan(workspaceId, points, options);
  }

  async resetCanvasRotation(workspaceId: string, options: KritaInputOptions = {}) {
    return this.actions.command(workspaceId, "reset_canvas_rotation", options);
  }
}
