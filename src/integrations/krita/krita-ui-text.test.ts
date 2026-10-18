import assert from "node:assert/strict";
import {
  extractKritaTargetText,
  parseKritaBrushSizeText,
  parseKritaZoomText,
  type KritaUiAutomationElement,
} from "./krita-ui-text.js";

const element = (input: Partial<KritaUiAutomationElement> & Pick<KritaUiAutomationElement, "controlType">): KritaUiAutomationElement => ({
  name: "",
  value: "",
  automationId: "",
  className: "",
  bounds: { x: 0, y: 0, width: 20, height: 20 },
  offscreen: false,
  ...input,
});

const brushElements = [
  element({ controlType: "ControlType.Spinner", className: "KisDoubleSliderSpinBox", value: "40.00" }),
];
assert.equal(extractKritaTargetText({ id: "brush-size", region: "toolbar" }, brushElements), "40.00");
assert.equal(parseKritaBrushSizeText("Size: 40.00 px"), 40);
assert.equal(parseKritaBrushSizeText("40 px"), 40);
assert.equal(parseKritaBrushSizeText("size: forty px"), undefined);

const layerElements = [
  element({ controlType: "ControlType.TreeItem", name: "Background" }),
  element({ controlType: "ControlType.TreeItem", name: "Background" }),
];
assert.equal(extractKritaTargetText({ id: "active-layer-name", region: "layers_docker" }, layerElements), "Background");

const statusElements = [
  element({ controlType: "ControlType.Text", name: "Fit View (110.6%)" }),
  element({ controlType: "ControlType.Text", name: "RGB/Alpha (8-bit integer/channel)" }),
];
assert.equal(extractKritaTargetText({ id: "status-bar", region: "status_bar" }, statusElements), "Fit View (110.6%)");
assert.equal(parseKritaZoomText("Fit View (110.6%)"), 110.6);
assert.equal(parseKritaZoomText("110.6%"), 110.6);
assert.equal(parseKritaZoomText("Fit View"), undefined);

assert.equal(
  extractKritaTargetText({ id: "color-hex-field", region: "color_hex_field" }, [
    element({ controlType: "ControlType.Edit", value: "#3366FF" }),
  ]),
  "#3366FF",
);

console.log("Krita UI text tests passed");
