# Roulette Game

A web-based roulette/lucky draw application that allows users to manage lots (entries), configure visualization modes (wheel or strip), and spin to select winners with weighted probability. Features include import/export functionality, multiple game modes, and customizable animation settings.

The application supports importing lots via CSV format with conflict resolution options to either replace existing data or merge new entries. Users can customize the spinning experience through adjustable animation duration, multiple easing functions for smooth deceleration effects, and real-time editing of lot amounts that immediately updates probability weights.

The app is built in TypeScript with a modular architecture: a `RouletteEngine` handles weighted random selection, canvas-based renderers (`WheelRenderer` / `StripRenderer`) draw the visualization via the `IRenderer` interface, and an `AnimationController` drives smooth spins with configurable easing functions. Two game modes are available — **Normal** (higher amount = higher chance to win) and **Survival** (lower amount = higher chance to be eliminated, last lot standing wins). The UI is internationalized via i18next, and all visualization logic is decoupled through a `VisualizationPackage` strategy, making it straightforward to add new rendering types.

This project was written entirely by AI, with a few attempts on my part to get it to write code that wasn't quite so strange
