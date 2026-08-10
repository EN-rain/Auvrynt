import { callRobloxStudioTool } from "./roblox-studio-client.js";

export type RobloxDatamodelType = "Edit" | "Client" | "Server";

function jsonForLuau(value: unknown): string {
  return JSON.stringify(value);
}

/** Resolve a dotted path like Workspace.Part or game.Workspace.Part in Luau. */
const RESOLVE_PATH_FN = `
local function resolvePath(path)
  if typeof(path) ~= "string" or path == "" then
    error("path must be a non-empty string")
  end
  local parts = string.split(path, ".")
  local i = 1
  if parts[1] == "game" then
    i = 2
  end
  local cur = game
  if parts[i] == "Place1" or parts[i] == "game" then
    i = i + 1
  end
  while i <= #parts do
    local name = parts[i]
    if name == "" then
      error("empty path segment in " .. path)
    end
    local nextInst = cur:FindFirstChild(name)
    if not nextInst then
      -- services are often direct children of DataModel via GetService
      local ok, svc = pcall(function()
        return game:GetService(name)
      end)
      if ok and svc and (cur == game or cur == game:GetService("Workspace") and false) then
        nextInst = svc
      end
    end
    if not nextInst and cur == game then
      local ok, svc = pcall(function()
        return game:GetService(name)
      end)
      if ok then nextInst = svc end
    end
    if not nextInst then
      error("could not resolve '" .. name .. "' under " .. cur:GetFullName() .. " (from " .. path .. ")")
    end
    cur = nextInst
    i = i + 1
  end
  return cur
end
`

const APPLY_PROPS_FN = `
local function parseColor3(v)
  if typeof(v) == "table" then
    if v.R ~= nil then return Color3.new(v.R, v.G or 0, v.B or 0) end
    if v[1] ~= nil then return Color3.fromRGB(v[1], v[2] or 0, v[3] or 0) end
  end
  if typeof(v) == "string" then
    local r, g, b = string.match(v, "^(%d+)%s*,%s*(%d+)%s*,%s*(%d+)$")
    if r then return Color3.fromRGB(tonumber(r), tonumber(g), tonumber(b)) end
  end
  return nil
end

local function parseVector3(v)
  if typeof(v) == "table" then
    if v.X ~= nil then return Vector3.new(v.X, v.Y or 0, v.Z or 0) end
    if v[1] ~= nil then return Vector3.new(v[1], v[2] or 0, v[3] or 0) end
  end
  return nil
end

local function applyProps(inst, props)
  if typeof(props) ~= "table" then return end
  for key, value in pairs(props) do
    if key == "Parent" then
      -- ignore Parent here; use set_parent helper
    elseif typeof(value) == "table" and value.__enum ~= nil then
      local enumName, itemName = string.match(tostring(value.__enum), "([^%.]+)%.(.+)")
      if not enumName then
        enumName = value.__enum
        itemName = value.item or value.name
      end
      local ok, enumType = pcall(function() return Enum[enumName] end)
      if ok and enumType and itemName then
        inst[key] = enumType[itemName]
      end
    elseif key == "Color" or key == "Color3" or key == "BackgroundColor3" or key == "TextColor3" or key == "ImageColor3" or key == "Ambient" or key == "OutdoorAmbient" or key == "FogColor" then
      local c = parseColor3(value)
      if c then inst[key] = c end
    elseif key == "Size" or key == "Position" or key == "Orientation" then
      local vec = parseVector3(value)
      if vec then
        if key == "Position" and inst:IsA("BasePart") then
          inst.Position = vec
        elseif key == "Size" and inst:IsA("BasePart") then
          inst.Size = vec
        elseif key == "Orientation" and inst:IsA("BasePart") then
          inst.Orientation = vec
        else
          pcall(function() inst[key] = vec end)
        end
      elseif typeof(value) ~= "table" then
        pcall(function() inst[key] = value end)
      end
    elseif key == "CFrame" and typeof(value) == "table" then
      local p = parseVector3(value.Position or value.position or value)
      if p and (value.Position or value.position) then
        inst.CFrame = CFrame.new(p)
      elseif value[1] then
        inst.CFrame = CFrame.new(value[1], value[2] or 0, value[3] or 0)
      end
    else
      pcall(function() inst[key] = value end)
    end
  end
end
`

async function runLuau(code: string, datamodelType: RobloxDatamodelType = "Edit"): Promise<unknown> {
  return callRobloxStudioTool("execute_luau", {
    code,
    datamodel_type: datamodelType,
  });
}

export async function robloxCreateInstance(opts: {
  className: string;
  parentPath: string;
  name?: string;
  properties?: Record<string, unknown>;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const name = opts.name ?? opts.className;
  const props = opts.properties ?? {};
  const code = `
${RESOLVE_PATH_FN}
${APPLY_PROPS_FN}
local parent = resolvePath(${jsonForLuau(opts.parentPath)})
local inst = Instance.new(${jsonForLuau(opts.className)})
inst.Name = ${jsonForLuau(name)}
applyProps(inst, game.HttpService:JSONDecode(${jsonForLuau(JSON.stringify(props))}))
inst.Parent = parent
return { ok = true, path = inst:GetFullName(), className = inst.ClassName, name = inst.Name }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxDestroyInstance(opts: {
  path: string;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
${RESOLVE_PATH_FN}
local inst = resolvePath(${jsonForLuau(opts.path)})
local full = inst:GetFullName()
inst:Destroy()
return { ok = true, destroyed = full }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxCloneInstance(opts: {
  path: string;
  parentPath?: string;
  name?: string;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
${RESOLVE_PATH_FN}
local src = resolvePath(${jsonForLuau(opts.path)})
local clone = src:Clone()
${opts.name ? `clone.Name = ${jsonForLuau(opts.name)}` : ""}
local parent = ${opts.parentPath ? `resolvePath(${jsonForLuau(opts.parentPath)})` : "src.Parent"}
clone.Parent = parent
return { ok = true, path = clone:GetFullName(), name = clone.Name, className = clone.ClassName }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxSetParent(opts: {
  path: string;
  parentPath: string;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
${RESOLVE_PATH_FN}
local inst = resolvePath(${jsonForLuau(opts.path)})
local parent = resolvePath(${jsonForLuau(opts.parentPath)})
inst.Parent = parent
return { ok = true, path = inst:GetFullName(), parent = parent:GetFullName() }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxRenameInstance(opts: {
  path: string;
  name: string;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
${RESOLVE_PATH_FN}
local inst = resolvePath(${jsonForLuau(opts.path)})
inst.Name = ${jsonForLuau(opts.name)}
return { ok = true, path = inst:GetFullName(), name = inst.Name }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxSetProperties(opts: {
  path: string;
  properties: Record<string, unknown>;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
${RESOLVE_PATH_FN}
${APPLY_PROPS_FN}
local inst = resolvePath(${jsonForLuau(opts.path)})
applyProps(inst, game.HttpService:JSONDecode(${jsonForLuau(JSON.stringify(opts.properties))}))
return { ok = true, path = inst:GetFullName() }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxSetAttribute(opts: {
  path: string;
  key: string;
  value: unknown;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
${RESOLVE_PATH_FN}
local inst = resolvePath(${jsonForLuau(opts.path)})
local value = game.HttpService:JSONDecode(${jsonForLuau(JSON.stringify({ v: opts.value }))}).v
inst:SetAttribute(${jsonForLuau(opts.key)}, value)
return { ok = true, path = inst:GetFullName(), key = ${jsonForLuau(opts.key)} }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxSetLighting(opts: {
  properties: Record<string, unknown>;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
${APPLY_PROPS_FN}
local lighting = game:GetService("Lighting")
applyProps(lighting, game.HttpService:JSONDecode(${jsonForLuau(JSON.stringify(opts.properties))}))
return { ok = true, path = lighting:GetFullName() }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxFillTerrainRegion(opts: {
  material?: string;
  x: number;
  y: number;
  z: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  resolution?: number;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const material = opts.material ?? "Grass";
  const resolution = opts.resolution ?? 4;
  const code = `
local terrain = workspace.Terrain
local mat = Enum.Material[${jsonForLuau(material)}]
local cf = CFrame.new(${opts.x}, ${opts.y}, ${opts.z})
local size = Vector3.new(${opts.sizeX}, ${opts.sizeY}, ${opts.sizeZ})
terrain:FillBlock(cf, size, mat)
return { ok = true, material = ${jsonForLuau(material)}, center = {${opts.x}, ${opts.y}, ${opts.z}}, size = {${opts.sizeX}, ${opts.sizeY}, ${opts.sizeZ}} }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxClearTerrain(opts: {
  datamodelType?: RobloxDatamodelType;
} = {}): Promise<unknown> {
  const code = `
workspace.Terrain:Clear()
return { ok = true }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxCreateScreenGui(opts: {
  name?: string;
  parentPath?: string;
  resetOnSpawn?: boolean;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const name = opts.name ?? "ScreenGui";
  const parentPath = opts.parentPath ?? "StarterGui";
  const resetOnSpawn = opts.resetOnSpawn !== false;
  const code = `
${RESOLVE_PATH_FN}
local parent = resolvePath(${jsonForLuau(parentPath)})
local gui = Instance.new("ScreenGui")
gui.Name = ${jsonForLuau(name)}
gui.ResetOnSpawn = ${resetOnSpawn ? "true" : "false"}
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = parent
return { ok = true, path = gui:GetFullName() }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxEnsurePostEffect(opts: {
  className: string;
  name?: string;
  properties?: Record<string, unknown>;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const name = opts.name ?? opts.className;
  const props = opts.properties ?? {};
  const code = `
${APPLY_PROPS_FN}
local lighting = game:GetService("Lighting")
local effect = lighting:FindFirstChild(${jsonForLuau(name)})
if not effect or effect.ClassName ~= ${jsonForLuau(opts.className)} then
  if effect then effect:Destroy() end
  effect = Instance.new(${jsonForLuau(opts.className)})
  effect.Name = ${jsonForLuau(name)}
  effect.Parent = lighting
end
applyProps(effect, game.HttpService:JSONDecode(${jsonForLuau(JSON.stringify(props))}))
return { ok = true, path = effect:GetFullName(), className = effect.ClassName }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxCreateGuiObject(opts: {
  className: string;
  parentPath: string;
  name?: string;
  properties?: Record<string, unknown>;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  return robloxCreateInstance({
    className: opts.className,
    parentPath: opts.parentPath,
    name: opts.name,
    properties: opts.properties,
    datamodelType: opts.datamodelType,
  });
}

export async function robloxCreateSound(opts: {
  parentPath: string;
  name?: string;
  soundId?: string;
  properties?: Record<string, unknown>;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const props: Record<string, unknown> = { ...(opts.properties ?? {}) };
  if (opts.soundId) props.SoundId = opts.soundId.startsWith("rbxassetid://") ? opts.soundId : `rbxassetid://${opts.soundId}`;
  return robloxCreateInstance({
    className: "Sound",
    parentPath: opts.parentPath,
    name: opts.name ?? "Sound",
    properties: props,
    datamodelType: opts.datamodelType,
  });
}

export async function robloxCreateConstraint(opts: {
  className: string;
  parentPath: string;
  name?: string;
  attachment0Path?: string;
  attachment1Path?: string;
  part0Path?: string;
  part1Path?: string;
  properties?: Record<string, unknown>;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const name = opts.name ?? opts.className;
  const props = opts.properties ?? {};
  const code = `
${RESOLVE_PATH_FN}
${APPLY_PROPS_FN}
local parent = resolvePath(${jsonForLuau(opts.parentPath)})
local c = Instance.new(${jsonForLuau(opts.className)})
c.Name = ${jsonForLuau(name)}
applyProps(c, game.HttpService:JSONDecode(${jsonForLuau(JSON.stringify(props))}))
${opts.attachment0Path ? `c.Attachment0 = resolvePath(${jsonForLuau(opts.attachment0Path)})` : ""}
${opts.attachment1Path ? `c.Attachment1 = resolvePath(${jsonForLuau(opts.attachment1Path)})` : ""}
${opts.part0Path ? `pcall(function() c.Part0 = resolvePath(${jsonForLuau(opts.part0Path)}) end)` : ""}
${opts.part1Path ? `pcall(function() c.Part1 = resolvePath(${jsonForLuau(opts.part1Path)}) end)` : ""}
c.Parent = parent
return { ok = true, path = c:GetFullName(), className = c.ClassName }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxSetCollisionGroup(opts: {
  path: string;
  groupName: string;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
${RESOLVE_PATH_FN}
local inst = resolvePath(${jsonForLuau(opts.path)})
local ps = game:GetService("PhysicsService")
local group = ${jsonForLuau(opts.groupName)}
local ok = pcall(function()
  ps:RegisterCollisionGroup(group)
end)
if inst:IsA("BasePart") then
  inst.CollisionGroup = group
else
  error("path must be a BasePart")
end
return { ok = true, path = inst:GetFullName(), collisionGroup = group }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxSetCollisionGroupCollidable(opts: {
  groupA: string;
  groupB: string;
  collidable: boolean;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
local ps = game:GetService("PhysicsService")
pcall(function() ps:RegisterCollisionGroup(${jsonForLuau(opts.groupA)}) end)
pcall(function() ps:RegisterCollisionGroup(${jsonForLuau(opts.groupB)}) end)
ps:CollisionGroupSetCollidable(${jsonForLuau(opts.groupA)}, ${jsonForLuau(opts.groupB)}, ${opts.collidable ? "true" : "false"})
return { ok = true, groupA = ${jsonForLuau(opts.groupA)}, groupB = ${jsonForLuau(opts.groupB)}, collidable = ${opts.collidable ? "true" : "false"} }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxFillTerrainBall(opts: {
  x: number;
  y: number;
  z: number;
  radius: number;
  material?: string;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const material = opts.material ?? "Grass";
  const code = `
local mat = Enum.Material[${jsonForLuau(material)}]
workspace.Terrain:FillBall(Vector3.new(${opts.x}, ${opts.y}, ${opts.z}), ${opts.radius}, mat)
return { ok = true, shape = "ball", material = ${jsonForLuau(material)} }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxSetWorkspaceGravity(opts: {
  gravity: number;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const code = `
workspace.Gravity = ${opts.gravity}
return { ok = true, gravity = workspace.Gravity }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}

export async function robloxCreateRemoteEvent(opts: {
  name: string;
  parentPath?: string;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  return robloxCreateInstance({
    className: "RemoteEvent",
    parentPath: opts.parentPath ?? "ReplicatedStorage",
    name: opts.name,
    datamodelType: opts.datamodelType,
  });
}

export async function robloxCreateRemoteFunction(opts: {
  name: string;
  parentPath?: string;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  return robloxCreateInstance({
    className: "RemoteFunction",
    parentPath: opts.parentPath ?? "ReplicatedStorage",
    name: opts.name,
    datamodelType: opts.datamodelType,
  });
}

export async function robloxCreateModuleScript(opts: {
  name: string;
  parentPath: string;
  source?: string;
  datamodelType?: RobloxDatamodelType;
}): Promise<unknown> {
  const source = opts.source ?? "local module = {}\n\nreturn module\n";
  const code = `
${RESOLVE_PATH_FN}
local parent = resolvePath(${jsonForLuau(opts.parentPath)})
local existing = parent:FindFirstChild(${jsonForLuau(opts.name)})
local mod
if existing and existing:IsA("ModuleScript") then
  mod = existing
else
  if existing then existing:Destroy() end
  mod = Instance.new("ModuleScript")
  mod.Name = ${jsonForLuau(opts.name)}
  mod.Parent = parent
end
mod.Source = ${jsonForLuau(source)}
return { ok = true, path = mod:GetFullName() }
`;
  return runLuau(code, opts.datamodelType ?? "Edit");
}
