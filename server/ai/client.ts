// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Shared Ollama client used by every AI module.
import { Ollama } from "ollama";

import { ollamaBaseUrl } from "../config.js";

export const ollama = new Ollama({ host: ollamaBaseUrl });
