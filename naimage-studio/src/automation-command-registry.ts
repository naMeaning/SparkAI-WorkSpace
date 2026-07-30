// Generated from integrations/naimage-control/references/commands.schema.json.
// Run `corepack pnpm run automation:generate` after editing the schema.
export const AUTOMATION_RENDERER_COMMAND_NAMES = [
  "app.state",
  "canvas.state",
  "project.list",
  "project.switch",
  "project.create",
  "project.rename",
  "canvas.select",
  "canvas.connect",
  "canvas.disconnect",
  "canvas.group",
  "canvas.dissolve",
  "canvas.nudge",
  "canvas.create-requirement",
  "canvas.update-requirement",
  "canvas.execute-requirement",
  "canvas.fit",
  "canvas.clear",
  "canvas.delete-selected",
  "canvas.create-container",
  "canvas.import",
  "canvas.import-skill",
  "canvas.export-image",
  "agent.chat",
  "agent.goal",
  "commerce.compose-set",
  "agent.steer",
  "agent.pause",
  "agent.resume",
  "agent.stop",
  "agent.new-conversation"
] as const;

export const AUTOMATION_COMMAND_DEFINITIONS = {
  "app.state": {},
  "canvas.state": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  },
  "project.list": {},
  "project.switch": {},
  "project.create": {},
  "project.rename": {},
  "canvas.select": {
    "parameters": {
      "type": "object",
      "required": [
        "ids"
      ],
      "additionalProperties": false,
      "properties": {
        "ids": {
          "type": "array",
          "maxItems": 240,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "uniqueItems": true
        },
        "primaryId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        }
      }
    }
  },
  "canvas.connect": {
    "parameters": {
      "type": "object",
      "required": [
        "edges",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "edges": {
          "type": "array",
          "minItems": 1,
          "maxItems": 240,
          "items": {
            "type": "object",
            "required": [
              "sourceId",
              "targetId"
            ],
            "additionalProperties": false,
            "properties": {
              "sourceId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160
              },
              "targetId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160
              },
              "relationType": {
                "type": "string",
                "enum": [
                  "derived-from",
                  "referenced",
                  "variant",
                  "grouped"
                ]
              },
              "inputRole": {
                "type": "string",
                "enum": [
                  "source",
                  "reference"
                ]
              }
            }
          }
        },
        "replaceExisting": {
          "type": "boolean",
          "default": false
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  },
  "canvas.disconnect": {
    "parameters": {
      "type": "object",
      "required": [
        "edges",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "edges": {
          "type": "array",
          "minItems": 1,
          "maxItems": 240,
          "items": {
            "type": "object",
            "required": [
              "sourceId",
              "targetId"
            ],
            "additionalProperties": false,
            "properties": {
              "sourceId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160
              },
              "targetId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160
              }
            }
          }
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  },
  "canvas.group": {
    "parameters": {
      "type": "object",
      "required": [
        "nodeIds",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "nodeIds": {
          "type": "array",
          "minItems": 2,
          "maxItems": 240,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "uniqueItems": true
        },
        "primaryId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  },
  "canvas.dissolve": {
    "parameters": {
      "type": "object",
      "required": [
        "containerIds",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "containerIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 120,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "uniqueItems": true
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  },
  "canvas.nudge": {
    "parameters": {
      "type": "object",
      "required": [
        "nodeIds",
        "dx",
        "dy",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "nodeIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 240,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "uniqueItems": true
        },
        "dx": {
          "type": "integer",
          "minimum": -10000,
          "maximum": 10000
        },
        "dy": {
          "type": "integer",
          "minimum": -10000,
          "maximum": 10000
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  },
  "canvas.create-requirement": {
    "parameters": {
      "type": "object",
      "required": [
        "text",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "title": {
          "type": "string",
          "maxLength": 120
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 24000
        },
        "inputBindings": {
          "type": "array",
          "maxItems": 240,
          "uniqueItems": true,
          "items": {
            "type": "object",
            "required": [
              "nodeId",
              "role"
            ],
            "additionalProperties": false,
            "properties": {
              "nodeId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160
              },
              "role": {
                "type": "string",
                "enum": [
                  "source",
                  "reference"
                ]
              }
            }
          }
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  },
  "canvas.update-requirement": {
    "parameters": {
      "type": "object",
      "required": [
        "nodeId",
        "expectedRevision",
        "patch",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "nodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        },
        "patch": {
          "type": "object",
          "minProperties": 1,
          "additionalProperties": false,
          "properties": {
            "title": {
              "type": "string",
              "maxLength": 120
            },
            "text": {
              "type": "string",
              "minLength": 1,
              "maxLength": 24000
            },
            "inputBindings": {
              "type": "array",
              "maxItems": 240,
              "uniqueItems": true,
              "items": {
                "type": "object",
                "required": [
                  "nodeId",
                  "role"
                ],
                "additionalProperties": false,
                "properties": {
                  "nodeId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160
                  },
                  "role": {
                    "type": "string",
                    "enum": [
                      "source",
                      "reference"
                    ]
                  }
                }
              }
            }
          }
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  },
  "canvas.execute-requirement": {
    "parameters": {
      "type": "object",
      "required": [
        "nodeId",
        "expectedRevision",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "nodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        },
        "confirmedUnchanged": {
          "type": "boolean",
          "default": false
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        }
      }
    }
  },
  "canvas.fit": {},
  "canvas.clear": {
    "destructive": true
  },
  "canvas.delete-selected": {
    "destructive": true
  },
  "canvas.create-container": {},
  "canvas.import": {},
  "canvas.import-skill": {},
  "canvas.export-image": {
    "parameters": {
      "type": "object",
      "required": [
        "nodeId"
      ],
      "additionalProperties": false,
      "properties": {
        "nodeId": {
          "type": "string"
        },
        "assetIndex": {
          "type": "integer",
          "minimum": 0,
          "default": 0
        },
        "format": {
          "type": "string",
          "enum": [
            "png",
            "jpeg",
            "webp",
            "avif",
            "tiff"
          ],
          "default": "png"
        }
      }
    }
  },
  "agent.chat": {
    "parameters": {
      "type": "object",
      "required": [
        "prompt"
      ],
      "additionalProperties": false,
      "properties": {
        "prompt": {
          "type": "string",
          "minLength": 1
        },
        "sourceNodeIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "uniqueItems": true,
          "default": []
        }
      }
    }
  },
  "agent.goal": {
    "parameters": {
      "type": "object",
      "required": [
        "prompt"
      ],
      "additionalProperties": false,
      "properties": {
        "prompt": {
          "type": "string",
          "minLength": 1
        },
        "sourceNodeIds": {
          "type": "array",
          "maxItems": 200,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "uniqueItems": true,
          "default": []
        },
        "operationsPerAsset": {
          "type": "integer",
          "minimum": 1,
          "maximum": 200,
          "default": 1
        },
        "confirmed": {
          "type": "boolean",
          "default": false
        },
        "expectedSnapshotHash": {
          "type": "string",
          "pattern": "^goal-[a-f0-9]{32}$"
        }
      }
    }
  },
  "commerce.compose-set": {
    "parameters": {
      "type": "object",
      "required": [
        "sourceNodeIds",
        "plan"
      ],
      "additionalProperties": false,
      "properties": {
        "sourceNodeIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 200,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "uniqueItems": true
        },
        "plan": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "mode": {
              "type": "string",
              "enum": [
                "generate",
                "translate"
              ],
              "default": "generate"
            },
            "title": {
              "type": "string",
              "maxLength": 120
            },
            "setSize": {
              "type": "integer",
              "minimum": 1,
              "maximum": 12
            },
            "slots": {
              "type": "array",
              "minItems": 1,
              "maxItems": 12,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "id": {
                    "type": "string",
                    "maxLength": 80
                  },
                  "title": {
                    "type": "string",
                    "maxLength": 80
                  },
                  "prompt": {
                    "type": "string",
                    "maxLength": 2000
                  }
                }
              }
            },
            "languageCodes": {
              "type": "array",
              "maxItems": 10,
              "items": {
                "type": "string",
                "minLength": 2,
                "maxLength": 32,
                "enum": [
                  "en-US",
                  "en-GB",
                  "de-DE",
                  "fr-FR",
                  "es-ES",
                  "it-IT",
                  "pt-BR",
                  "ja-JP",
                  "ko-KR",
                  "ar-SA",
                  "ru-RU",
                  "th-TH",
                  "vi-VN",
                  "id-ID"
                ]
              },
              "uniqueItems": true
            },
            "targetLocales": {
              "type": "array",
              "maxItems": 10,
              "items": {
                "type": "object",
                "required": [
                  "code"
                ],
                "additionalProperties": false,
                "properties": {
                  "code": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 32,
                    "enum": [
                      "en-US",
                      "en-GB",
                      "de-DE",
                      "fr-FR",
                      "es-ES",
                      "it-IT",
                      "pt-BR",
                      "ja-JP",
                      "ko-KR",
                      "ar-SA",
                      "ru-RU",
                      "th-TH",
                      "vi-VN",
                      "id-ID"
                    ]
                  },
                  "prompt": {
                    "type": "string",
                    "maxLength": 800
                  }
                }
              }
            },
            "translatePrompt": {
              "type": "string",
              "maxLength": 2000
            },
            "saveTarget": {
              "type": "string",
              "enum": [
                "none",
                "requirement",
                "skill"
              ],
              "default": "none"
            },
            "reusableName": {
              "type": "string",
              "maxLength": 120
            }
          }
        },
        "confirmed": {
          "type": "boolean",
          "default": false
        },
        "expectedSnapshotHash": {
          "type": "string",
          "pattern": "^goal-[a-f0-9]{32}$"
        }
      }
    }
  },
  "agent.steer": {
    "parameters": {
      "type": "object",
      "required": [
        "prompt"
      ],
      "additionalProperties": false,
      "properties": {
        "prompt": {
          "type": "string",
          "minLength": 1
        },
        "taskScopeMode": {
          "type": "string",
          "enum": [
            "keep",
            "replace-source",
            "merge-source",
            "replace-reference",
            "merge-reference",
            "clear-attachments"
          ],
          "default": "keep"
        },
        "sourceMode": {
          "type": "string",
          "enum": [
            "keep",
            "replace",
            "merge",
            "clear"
          ]
        },
        "referenceMode": {
          "type": "string",
          "enum": [
            "keep",
            "replace",
            "merge",
            "clear"
          ]
        },
        "sourceNodeIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "uniqueItems": true,
          "default": []
        },
        "referenceNodeIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "uniqueItems": true,
          "default": []
        }
      }
    }
  },
  "agent.pause": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  },
  "agent.resume": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  },
  "agent.stop": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  },
  "agent.new-conversation": {}
} as const;

export const AUTOMATION_COMMAND_ENUMS = {
  "canvas.export-image": {
    "format": [
      "png",
      "jpeg",
      "webp",
      "avif",
      "tiff"
    ]
  },
  "agent.steer": {
    "taskScopeMode": [
      "keep",
      "replace-source",
      "merge-source",
      "replace-reference",
      "merge-reference",
      "clear-attachments"
    ],
    "sourceMode": [
      "keep",
      "replace",
      "merge",
      "clear"
    ],
    "referenceMode": [
      "keep",
      "replace",
      "merge",
      "clear"
    ]
  }
} as const;

export type AutomationRendererCommandName = typeof AUTOMATION_RENDERER_COMMAND_NAMES[number];

const automationRendererCommandNames = new Set<string>(AUTOMATION_RENDERER_COMMAND_NAMES);

export function isAutomationRendererCommandName(value: string): value is AutomationRendererCommandName {
  return automationRendererCommandNames.has(value);
}
