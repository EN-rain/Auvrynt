import assert from "node:assert/strict";
import { parseCsharpFile, generateCsharpScript } from "./godot-csharp-semantic.js";
import { parseCsharpExceptions } from "./godot-runtime-testing.js";

// 1. Test C# class parser
const sampleCs = `using Godot;

namespace SpaceGame
{
    public partial class Player : CharacterBody2D
    {
        [Export]
        public float Speed { get; set; } = 200.0f;

        [Signal]
        public delegate void DiedEventHandler();

        public override void _Ready()
        {
        }

        public override void _PhysicsProcess(double delta)
        {
        }
    }
}`;

const classes = parseCsharpFile(sampleCs, "Player.cs");
assert.equal(classes.length, 1);
const cls = classes[0];
assert.equal(cls.className, "Player");
assert.equal(cls.baseClass, "CharacterBody2D");
assert.equal(cls.isPartial, true);
assert.equal(cls.namespace, "SpaceGame");
assert.equal(cls.exportedProperties.length, 1);
assert.equal(cls.exportedProperties[0].propertyName, "Speed");
assert.equal(cls.signals.length, 1);
assert.equal(cls.signals[0].name, "Died");
assert.ok(cls.lifecycleOverrides.includes("_Ready"));
assert.ok(cls.lifecycleOverrides.includes("_PhysicsProcess"));

// 2. Test C# script generation
const script = await generateCsharpScript({ className: "Enemy", baseType: "CharacterBody2D", namespace: "SpaceGame" });
assert.ok(script.includes("public partial class Enemy : CharacterBody2D"));
assert.ok(script.includes("namespace SpaceGame"));
assert.ok(script.includes("override void _Ready"));

// 3. Test C# exception parsing
const exceptionLog = [
  "System.NullReferenceException: Object reference not set.",
  "   at SpaceGame.Enemy._Process(Double delta) in C:\\game\\Enemy.cs:line 20",
  "---> System.InvalidOperationException: Cannot access disposed object",
  "INFO: Enemy spawned",
  "System.NullReferenceException: Object reference not set.",  // repeat
];

const exceptions = parseCsharpExceptions(exceptionLog);
// NullRef appears twice (collapsed as repeatCount=2), InvalidOperation is inner on it
const nullRefEx = exceptions.find(e => e.exceptionType === "NullReferenceException");
assert.ok(nullRefEx, "NullReferenceException not found");
assert.equal(nullRefEx!.repeatCount, 2);
assert.equal(nullRefEx!.stackFrames.length, 1);
assert.equal(nullRefEx!.stackFrames[0].path, "C:\\game\\Enemy.cs");
assert.equal(nullRefEx!.stackFrames[0].line, 20);
assert.equal(nullRefEx!.innerExceptions.length, 1);
assert.equal(nullRefEx!.innerExceptions[0].exceptionType, "InvalidOperationException");
