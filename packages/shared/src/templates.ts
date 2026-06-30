// Шаблоны документов по типам — структура (как в Campaign Arks), которой следует
// и первичная генерация, и последующая правка. Заголовки/подписи на английском
// (как в эталоне), значения заполняются по-русски.

const NPC = `## Core Profile
- **Role / Occupation**:
- **Heritage / Species**:
- **Faction & Location Ties**:

## Appearance & Presence
- **First Impression**:
- **Distinctive Feature**:
- **Voice & Mannerisms**:

## Personality
- **Core Traits**:
- **Roleplay Guidance**:
- **Taboos / Boundaries**:

## Motivations & Goals
- **Immediate Want**:
- **Long-Term Goal**:
- **Secrets & Weaknesses**:

## Background


## Connections
- **Allies / Patrons**:
- **Rivals / Enemies**:
- **Party Relationship**:

## Story Function
- **Use at the Table**:
- **Hooks**: `;

const PC = `## Core Profile
- **Concept**:
- **Heritage / Species**:
- **Class / Role**:

## Appearance & Presence
- **First Impression**:
- **Distinctive Feature**:

## Personality
- **Core Traits**:
- **Ideals / Bonds / Flaws**:

## Background


## Motivations & Goals
- **Immediate Want**:
- **Long-Term Goal**:

## Connections
- **Allies / Patrons**:
- **Rivals / Enemies**: `;

const LOCATION = `## Location Snapshot
- **Type / Scale**:
- **Purpose / Significance**:
- **Status**:
- **Mood**:
- **Core Tension**:

## First Impression
- **Sights**:
- **Sounds**:
- **Other Sense**:

## Layout & Notable Areas
- **Entrances / Exits**:
- **Key Area**:

## Interactive Elements
- **Feature / Object**:
- **Hazard / Obstacle**:
- **Service / Resource**:

## Inhabitants & Local Dynamics
- **Regulars / Residents**:
- **Visitors / Intruders**:
- **Local Rules or Customs**:

## Secrets
- **Hidden Feature**:
- **GM-Only Note**:

## Hooks & Connections
- **Adventure Hook**:
- **Connected Documents**: `;

const FACTION = `## Overview
- **Identity**:
- **Public Face**:
- **Hidden Reality**:
- **Sphere of Influence**:

## Goals & Agenda
- **Immediate Goal**:
- **Long-Term Aim**:
- **Current Pressure**:
- **Red Lines**:

## Structure
- **Leadership**:
- **Key Figures**:
- **Membership**:

## Methods & Resources
- **Methods**:
- **Resources**:
- **Influence Channels**:
- **Weaknesses**:

## Relationships
- **Allies**:
- **Rivals**:
- **Dependencies & Friction**:

## Current Posture
- **Active Moves**:
- **Relation to PCs**:
- **Hooks & Consequences**: `;

const SECRET = `## The Secret
- **What's Hidden**:
- **Who Knows**:

## Truth (GM-Only)


## Clues & Reveal
- **Clue**:
- **How It Surfaces**:

## Consequences`;

const SCENE = `## Scene Goal
- **Purpose**:
- **Success / Failure Triggers**:

## Setup
- **Where & When**:
- **Present NPCs**:

## Beats


## Complications


## Outcomes & Hooks`;

const ENCOUNTER = `## Encounter Overview
- **Type**:
- **Trigger**:
- **Stakes**:

## Opposition
- **Foes / Threats**:
- **Tactics**:

## Environment
- **Terrain / Hazards**:

## Resolution
- **Win / Lose / Escape**:
- **Rewards & Hooks**: `;

const ARC = `## Arc Overview
- **Premise**:
- **Theme**:
- **Status**:

## Stakes & Driving Question


## Key Beats
1.
2.
3.

## Key Players & Locations


## Possible Outcomes`;

const ITEM = `## Item Overview
- **Type**:
- **Rarity / Status**:
- **Appearance**:

## Properties
- **Powers / Effects**:
- **Drawbacks / Costs**:

## History & Lore


## Hooks`;

const LORE = `## Overview


## Key Facts
-

## History


## Implications & Hooks`;

const REFERENCE = `## Summary & Intent
- **Type**:
- **Audience**:
- **Purpose**:

## Quick Reference


## How to Use This


## Details


## GM Notes & Play Guidance`;

const SESSION = `## Session Goal


## Recap


## Planned Beats
1.
2.

## NPCs & Locations


## Notes & Follow-ups`;

export const DOCUMENT_TEMPLATES: Record<string, string> = {
  npc: NPC,
  pc: PC,
  location: LOCATION,
  faction: FACTION,
  secret: SECRET,
  scene: SCENE,
  encounter: ENCOUNTER,
  arc: ARC,
  item: ITEM,
  lore: LORE,
  reference: REFERENCE,
  session: SESSION,
  // note — свободный формат, без шаблона
};

export function getTemplate(type: string): string | undefined {
  return DOCUMENT_TEMPLATES[type];
}
