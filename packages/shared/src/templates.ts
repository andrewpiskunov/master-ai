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

// Короткие подсказки по типам — что стоит указать в документе (как «Tips» в Arks).
export const DOCUMENT_TIPS: Record<string, string[]> = {
  session: [
    "Сведите материал прошлых сессий, чтобы спланировать следующую",
    "Перечислите игровые материалы: сцены, столкновения, секреты",
    "Отметьте возможные выборы игроков и их последствия",
  ],
  npc: [
    "Опишите черты характера, мотивацию и цели",
    "Добавьте внешность и манеры",
    "Отметьте связи с другими NPC и персонажами игроков",
  ],
  location: [
    "Опишите атмосферу и ключевые особенности",
    "Укажите важных NPC, которые здесь бывают",
    "Отметьте секреты, опасности и возможности",
  ],
  arc: [
    "Наметьте начало, середину и финал",
    "Определите ключевых NPC и их роли",
    "Запланируйте крупные повороты и выборы игроков",
  ],
  encounter: [
    "Задайте сцену и опишите окружение",
    "Перечислите противников, их тактику и мотивы",
    "Укажите возможные награды и последствия",
  ],
  pc: [
    "Запишите класс, расу и уровень",
    "Отслеживайте имя игрока и статус персонажа",
    "Отметьте цели и развитие персонажа",
  ],
  lore: [
    "Опишите историческое или культурное значение",
    "Укажите, кто владеет этой информацией",
    "Добавьте, как это влияет на текущий сюжет",
  ],
  scene: [
    "Задайте настроение и атмосферу",
    "Подготовьте ключевые реплики или описания",
    "Запланируйте возможные исходы и последствия",
  ],
  secret: [
    "Отметьте, как игроки могут это раскрыть",
    "Отслеживайте, раскрыто ли это",
    "Свяжите с подходящими сюжетными арками",
  ],
  item: [
    "Опишите предмет и его свойства",
    "Укажите редкость и требования настройки",
    "Отслеживайте, кто им владеет и когда получил",
  ],
  faction: [
    "Опишите цели, структуру и методы фракции",
    "Отслеживайте отношение и репутацию у партии",
    "Отметьте союзников, врагов и важных лидеров",
  ],
  reference: [
    "Используйте понятные заголовки для быстрого поиска в игре",
    "Группируйте связанные правила в один документ, а не множество мелких",
    "Держите механику системы отдельно от канона мира (он — в Лоре)",
  ],
};

export function getTips(type: string): string[] {
  return DOCUMENT_TIPS[type] ?? [];
}
