// Generated from integrations/naimage-control/references/commands.schema.json.
// Run `corepack pnpm run automation:generate` after editing the schema.
export const AUTOMATION_RENDERER_COMMAND_NAMES = [
  "app.state",
  "canvas.state",
  "workspace.domain.list",
  "workspace.domain.get",
  "workspace.domain.set",
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
  "canvas.import-video",
  "canvas.generate-video",
  "canvas.import-skill",
  "canvas.rename-image-collections",
  "canvas.replace-image-collection-item",
  "canvas.export-image-collections",
  "canvas.export-image",
  "requirement-library.list",
  "requirement-library.save",
  "requirement-library.delete",
  "requirement-library.use",
  "commerce.template.list",
  "commerce.template.save",
  "commerce.template.delete",
  "commerce.template.import",
  "commerce.template.export",
  "commerce.catalog.list",
  "commerce.catalog.upsert",
  "commerce.catalog.delete",
  "commerce.catalog.assign",
  "commerce.catalog.remove",
  "commerce.catalog.review",
  "commerce.catalog.compare",
  "commerce.catalog.select",
  "commerce.export.preview",
  "commerce.export.package",
  "social.xiaohongshu.plan",
  "social.xiaohongshu.execute",
  "social.xiaohongshu.export",
  "social.douyin.plan",
  "social.douyin.execute",
  "social.douyin.status",
  "social.douyin.export",
  "research.data.import",
  "research.data.list",
  "research.figure.plan",
  "research.figure.render",
  "research.figure.status",
  "research.figure.export",
  "research.figure.cancel",
  "agent.chat",
  "agent.goal",
  "commerce.compose-set",
  "agent.steer",
  "agent.pause",
  "agent.resume",
  "agent.stop",
  "agent.new-conversation"
] as const;

export const AUTOMATION_SERVICE_COMMAND_NAMES = [
  "status",
  "debug.runtime-state",
  "debug.renderer-logs",
  "debug.main-logs",
  "debug.run-targeted-test",
  "debug.capture-window",
  "debug.inspect-ipc",
  "debug.inspect-command"
] as const;

export const AUTOMATION_COMMAND_NAMES = [
  "status",
  "app.state",
  "canvas.state",
  "debug.runtime-state",
  "debug.renderer-logs",
  "debug.main-logs",
  "debug.run-targeted-test",
  "debug.capture-window",
  "debug.inspect-ipc",
  "debug.inspect-command",
  "workspace.domain.list",
  "workspace.domain.get",
  "workspace.domain.set",
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
  "canvas.import-video",
  "canvas.generate-video",
  "canvas.import-skill",
  "canvas.rename-image-collections",
  "canvas.replace-image-collection-item",
  "canvas.export-image-collections",
  "canvas.export-image",
  "requirement-library.list",
  "requirement-library.save",
  "requirement-library.delete",
  "requirement-library.use",
  "commerce.template.list",
  "commerce.template.save",
  "commerce.template.delete",
  "commerce.template.import",
  "commerce.template.export",
  "commerce.catalog.list",
  "commerce.catalog.upsert",
  "commerce.catalog.delete",
  "commerce.catalog.assign",
  "commerce.catalog.remove",
  "commerce.catalog.review",
  "commerce.catalog.compare",
  "commerce.catalog.select",
  "commerce.export.preview",
  "commerce.export.package",
  "social.xiaohongshu.plan",
  "social.xiaohongshu.execute",
  "social.xiaohongshu.export",
  "social.douyin.plan",
  "social.douyin.execute",
  "social.douyin.status",
  "social.douyin.export",
  "research.data.import",
  "research.data.list",
  "research.figure.plan",
  "research.figure.render",
  "research.figure.status",
  "research.figure.export",
  "research.figure.cancel",
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
  "status": {},
  "app.state": {},
  "canvas.state": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  },
  "debug.runtime-state": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  },
  "debug.renderer-logs": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500,
          "default": 100
        }
      }
    }
  },
  "debug.main-logs": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500,
          "default": 100
        }
      }
    }
  },
  "debug.run-targeted-test": {
    "parameters": {
      "type": "object",
      "required": [
        "testName"
      ],
      "additionalProperties": false,
      "properties": {
        "testName": {
          "type": "string",
          "enum": [
            "typecheck",
            "test:automation-debug",
            "test:mcp-wrapper",
            "test:ipc-registration",
            "test:workspace-domain",
            "test:automation-service",
            "test:scientific-runner",
            "test:commerce-template"
          ]
        },
        "timeoutMs": {
          "type": "integer",
          "minimum": 1000,
          "maximum": 120000,
          "default": 60000
        }
      }
    }
  },
  "debug.capture-window": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "label": {
          "type": "string",
          "maxLength": 80,
          "default": "window"
        },
        "scope": {
          "type": "string",
          "enum": [
            "page",
            "window"
          ],
          "default": "page"
        }
      }
    }
  },
  "debug.inspect-ipc": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  },
  "debug.inspect-command": {
    "parameters": {
      "type": "object",
      "required": [
        "name"
      ],
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        }
      }
    }
  },
  "workspace.domain.list": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  },
  "workspace.domain.get": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  },
  "workspace.domain.set": {
    "parameters": {
      "type": "object",
      "required": [
        "domain",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "domain": {
          "type": "string",
          "enum": [
            "general",
            "commerce",
            "social",
            "research"
          ]
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        }
      }
    }
  },
  "project.list": {},
  "project.switch": {},
  "project.create": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": "string",
          "maxLength": 60
        },
        "workspaceDomain": {
          "type": "string",
          "enum": [
            "general",
            "commerce",
            "social",
            "research"
          ]
        }
      }
    }
  },
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
  "canvas.import-video": {
    "parameters": {
      "type": "object",
      "required": [
        "paths"
      ],
      "additionalProperties": false,
      "properties": {
        "paths": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 32767
          }
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        }
      }
    }
  },
  "canvas.generate-video": {
    "parameters": {
      "type": "object",
      "required": [
        "prompt",
        "expectedProjectId",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "prompt": {
          "type": "string",
          "minLength": 1,
          "maxLength": 20000
        },
        "model": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240
        },
        "seconds": {
          "type": "integer",
          "minimum": 1,
          "maximum": 60,
          "default": 5
        },
        "aspectRatio": {
          "type": "string",
          "enum": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4"
          ],
          "default": "16:9"
        },
        "resolution": {
          "type": "string",
          "enum": [
            "480p",
            "720p",
            "1080p"
          ],
          "default": "720p"
        },
        "x": {
          "type": "number",
          "default": 240
        },
        "y": {
          "type": "number",
          "default": 180
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    }
  },
  "canvas.import-skill": {},
  "canvas.rename-image-collections": {
    "parameters": {
      "type": "object",
      "required": [
        "requests",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "requests": {
          "type": "array",
          "minItems": 1,
          "maxItems": 200,
          "items": {
            "type": "object",
            "required": [
              "collectionId",
              "name"
            ],
            "additionalProperties": false,
            "properties": {
              "collectionId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 240
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
  "canvas.replace-image-collection-item": {
    "parameters": {
      "type": "object",
      "required": [
        "requests",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "requests": {
          "type": "array",
          "minItems": 1,
          "maxItems": 200,
          "items": {
            "type": "object",
            "required": [
              "sourceCollectionId",
              "replacementNodeId",
              "replacementAssetIndex",
              "defectReason"
            ],
            "additionalProperties": false,
            "properties": {
              "sourceCollectionId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "itemId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "requestIndex": {
                "type": "integer",
                "minimum": 1,
                "maximum": 200
              },
              "replacementNodeId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160
              },
              "replacementAssetIndex": {
                "type": "integer",
                "minimum": 0,
                "maximum": 199
              },
              "defectReason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 320
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
  "canvas.export-image-collections": {
    "parameters": {
      "type": "object",
      "required": [
        "collectionIds",
        "expectedProjectId",
        "format",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "collectionIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 200,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          }
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
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
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    }
  },
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
  "requirement-library.list": {
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "includeText": {
          "type": "boolean",
          "default": false
        }
      }
    }
  },
  "requirement-library.save": {
    "parameters": {
      "type": "object",
      "required": [
        "nodeId",
        "expectedRequirementRevision",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "nodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedRequirementRevision": {
          "type": "integer",
          "minimum": 1
        },
        "templateId": {
          "type": "string",
          "pattern": "^reqtpl-[a-f0-9]{32}$"
        },
        "expectedTemplateRevision": {
          "type": "integer",
          "minimum": 1
        },
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        }
      }
    }
  },
  "requirement-library.delete": {
    "parameters": {
      "type": "object",
      "required": [
        "templateId",
        "expectedTemplateRevision",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "templateId": {
          "type": "string",
          "pattern": "^reqtpl-[a-f0-9]{32}$"
        },
        "expectedTemplateRevision": {
          "type": "integer",
          "minimum": 1
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    },
    "destructive": true
  },
  "requirement-library.use": {
    "parameters": {
      "type": "object",
      "required": [
        "templateId",
        "expectedTemplateRevision",
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "templateId": {
          "type": "string",
          "pattern": "^reqtpl-[a-f0-9]{32}$"
        },
        "expectedTemplateRevision": {
          "type": "integer",
          "minimum": 1
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
  "commerce.template.list": {},
  "commerce.template.save": {
    "parameters": {
      "type": "object",
      "required": [
        "title",
        "plan"
      ],
      "additionalProperties": false,
      "properties": {
        "templateId": {
          "type": "string",
          "pattern": "^commerce-template-[a-f0-9]{32}$"
        },
        "expectedTemplateRevision": {
          "type": "integer",
          "minimum": 1
        },
        "conflictPolicy": {
          "type": "string",
          "enum": [
            "overwrite",
            "copy"
          ]
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "description": {
          "type": "string",
          "maxLength": 600
        },
        "plan": {
          "type": "object",
          "required": [
            "mode"
          ],
          "additionalProperties": false,
          "properties": {
            "schemaVersion": {
              "type": "integer",
              "enum": [
                1
              ],
              "default": 1
            },
            "mode": {
              "type": "string",
              "enum": [
                "generate",
                "translate"
              ]
            },
            "platformTemplateId": {
              "type": "string",
              "enum": [
                "general",
                "amazon",
                "aliexpress"
              ],
              "default": "general"
            },
            "title": {
              "type": "string",
              "maxLength": 120
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
            }
          }
        }
      }
    }
  },
  "commerce.template.delete": {
    "parameters": {
      "type": "object",
      "required": [
        "templateId",
        "expectedTemplateRevision",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "templateId": {
          "type": "string",
          "pattern": "^commerce-template-[a-f0-9]{32}$"
        },
        "expectedTemplateRevision": {
          "type": "integer",
          "minimum": 1
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    },
    "destructive": true
  },
  "commerce.template.import": {},
  "commerce.template.export": {
    "parameters": {
      "type": "object",
      "required": [
        "templateId"
      ],
      "additionalProperties": false,
      "properties": {
        "templateId": {
          "type": "string",
          "pattern": "^(?:commerce-builtin-(?:amazon|aliexpress)|commerce-template-[a-f0-9]{32})$"
        },
        "expectedTemplateRevision": {
          "type": "integer",
          "minimum": 1
        }
      }
    }
  },
  "commerce.catalog.list": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "includeArchived": {
          "type": "boolean",
          "default": false
        }
      }
    }
  },
  "commerce.catalog.upsert": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCatalogRevision",
        "product"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCatalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "product": {
          "type": "object",
          "required": [
            "title"
          ],
          "additionalProperties": false,
          "properties": {
            "productId": {
              "type": "string",
              "pattern": "^product-[a-f0-9]{32}$"
            },
            "expectedProductRevision": {
              "type": "integer",
              "minimum": 1
            },
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160
            },
            "productCode": {
              "type": "string",
              "maxLength": 120
            },
            "brand": {
              "type": "string",
              "maxLength": 120
            },
            "brandStyle": {
              "type": "object",
              "required": [
                "enabled"
              ],
              "additionalProperties": false,
              "properties": {
                "version": {
                  "type": "integer",
                  "enum": [
                    1
                  ],
                  "default": 1
                },
                "enabled": {
                  "type": "boolean"
                },
                "fontFamily": {
                  "type": "string",
                  "maxLength": 120
                },
                "colors": {
                  "type": "array",
                  "maxItems": 8,
                  "uniqueItems": true,
                  "items": {
                    "type": "string",
                    "pattern": "^#[a-fA-F0-9]{6}$"
                  }
                },
                "logoUsage": {
                  "type": "string",
                  "maxLength": 600
                },
                "modelAppearance": {
                  "type": "string",
                  "maxLength": 600
                },
                "productAppearance": {
                  "type": "string",
                  "maxLength": 600
                },
                "visualStyle": {
                  "type": "string",
                  "maxLength": 600
                }
              }
            },
            "platforms": {
              "type": "array",
              "maxItems": 2,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "enum": [
                  "amazon",
                  "aliexpress"
                ]
              }
            },
            "variants": {
              "type": "array",
              "maxItems": 500,
              "items": {
                "type": "object",
                "required": [
                  "title"
                ],
                "additionalProperties": false,
                "properties": {
                  "variantId": {
                    "type": "string",
                    "pattern": "^variant-[a-f0-9]{32}$"
                  },
                  "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 120
                  },
                  "optionValues": {
                    "type": "array",
                    "maxItems": 24,
                    "items": {
                      "type": "object",
                      "required": [
                        "name",
                        "value"
                      ],
                      "additionalProperties": false,
                      "properties": {
                        "name": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 60
                        },
                        "value": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 120
                        }
                      }
                    }
                  }
                }
              }
            },
            "skus": {
              "type": "array",
              "maxItems": 1000,
              "items": {
                "type": "object",
                "required": [
                  "skuCode"
                ],
                "additionalProperties": false,
                "properties": {
                  "skuId": {
                    "type": "string",
                    "pattern": "^sku-[a-f0-9]{32}$"
                  },
                  "skuCode": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 120
                  },
                  "title": {
                    "type": "string",
                    "maxLength": 120
                  },
                  "variantId": {
                    "type": "string",
                    "pattern": "^variant-[a-f0-9]{32}$"
                  },
                  "variantIndex": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 499
                  },
                  "platforms": {
                    "type": "array",
                    "maxItems": 2,
                    "uniqueItems": true,
                    "items": {
                      "type": "string",
                      "enum": [
                        "amazon",
                        "aliexpress"
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "commerce.catalog.delete": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCatalogRevision",
        "productId",
        "expectedProductRevision",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCatalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "productId": {
          "type": "string",
          "pattern": "^product-[a-f0-9]{32}$"
        },
        "expectedProductRevision": {
          "type": "integer",
          "minimum": 1
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    },
    "destructive": true
  },
  "commerce.catalog.assign": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCatalogRevision",
        "expectedCanvasRevision",
        "productId",
        "expectedProductRevision",
        "kind",
        "ownerType",
        "role",
        "assets"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCatalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        },
        "productId": {
          "type": "string",
          "pattern": "^product-[a-f0-9]{32}$"
        },
        "expectedProductRevision": {
          "type": "integer",
          "minimum": 1
        },
        "kind": {
          "type": "string",
          "enum": [
            "master",
            "brand",
            "result"
          ]
        },
        "ownerType": {
          "type": "string",
          "enum": [
            "product",
            "variant",
            "sku"
          ]
        },
        "ownerId": {
          "type": "string",
          "maxLength": 48
        },
        "role": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "assets": {
          "type": "array",
          "minItems": 1,
          "maxItems": 200,
          "uniqueItems": true,
          "items": {
            "type": "object",
            "required": [
              "nodeId",
              "assetIndex"
            ],
            "additionalProperties": false,
            "properties": {
              "nodeId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160
              },
              "assetIndex": {
                "type": "integer",
                "minimum": 0
              }
            }
          }
        }
      }
    }
  },
  "commerce.catalog.remove": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCatalogRevision",
        "productId",
        "expectedProductRevision",
        "linkId"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCatalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "productId": {
          "type": "string",
          "pattern": "^product-[a-f0-9]{32}$"
        },
        "expectedProductRevision": {
          "type": "integer",
          "minimum": 1
        },
        "linkId": {
          "type": "string",
          "pattern": "^(?:material|result)-[a-f0-9]{32}$"
        }
      }
    }
  },
  "commerce.catalog.review": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCatalogRevision",
        "productId",
        "expectedProductRevision",
        "linkIds",
        "state"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCatalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "productId": {
          "type": "string",
          "pattern": "^product-[a-f0-9]{32}$"
        },
        "expectedProductRevision": {
          "type": "integer",
          "minimum": 1
        },
        "linkIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 200,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^result-[a-f0-9]{32}$"
          }
        },
        "state": {
          "type": "string",
          "enum": [
            "candidate",
            "approved",
            "rejected"
          ]
        }
      }
    }
  },
  "commerce.catalog.compare": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "productId": {
          "type": "string",
          "pattern": "^product-[a-f0-9]{32}$"
        }
      }
    }
  },
  "commerce.catalog.select": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCatalogRevision",
        "productId",
        "expectedProductRevision",
        "groupKey",
        "winnerLinkId"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCatalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "productId": {
          "type": "string",
          "pattern": "^product-[a-f0-9]{32}$"
        },
        "expectedProductRevision": {
          "type": "integer",
          "minimum": 1
        },
        "groupKey": {
          "type": "string",
          "pattern": "^comparison-[a-f0-9]{32}$"
        },
        "winnerLinkId": {
          "type": "string",
          "pattern": "^result-[a-f0-9]{32}$"
        }
      }
    }
  },
  "commerce.export.preview": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCatalogRevision",
        "platform",
        "format"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCatalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "platform": {
          "type": "string",
          "enum": [
            "amazon",
            "aliexpress"
          ]
        },
        "format": {
          "type": "string",
          "enum": [
            "jpeg",
            "png"
          ]
        },
        "includeCandidates": {
          "type": "boolean",
          "default": false
        },
        "productIds": {
          "type": "array",
          "maxItems": 500,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^product-[a-f0-9]{32}$"
          }
        },
        "skuIds": {
          "type": "array",
          "maxItems": 500,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^sku-[a-f0-9]{32}$"
          }
        }
      }
    }
  },
  "commerce.export.package": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCatalogRevision",
        "platform",
        "format",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCatalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "platform": {
          "type": "string",
          "enum": [
            "amazon",
            "aliexpress"
          ]
        },
        "format": {
          "type": "string",
          "enum": [
            "jpeg",
            "png"
          ]
        },
        "includeCandidates": {
          "type": "boolean",
          "default": false
        },
        "productIds": {
          "type": "array",
          "maxItems": 500,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^product-[a-f0-9]{32}$"
          }
        },
        "skuIds": {
          "type": "array",
          "maxItems": 500,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^sku-[a-f0-9]{32}$"
          }
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    }
  },
  "social.xiaohongshu.plan": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCanvasRevision",
        "brief"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        },
        "sourceNodeIds": {
          "type": "array",
          "maxItems": 200,
          "uniqueItems": true,
          "default": [],
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          }
        },
        "brief": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "contentKind": {
          "type": "string",
          "enum": [
            "product-seeding",
            "tutorial",
            "comparison",
            "knowledge",
            "list",
            "experience-share",
            "travel"
          ],
          "default": "experience-share"
        },
        "audience": {
          "type": "string",
          "maxLength": 500
        },
        "objective": {
          "type": "string",
          "maxLength": 1000
        },
        "language": {
          "type": "string",
          "maxLength": 80,
          "default": "跟随用户"
        },
        "ratio": {
          "type": "string",
          "enum": [
            "3:4",
            "4:5",
            "1:1"
          ],
          "default": "3:4"
        },
        "cardCount": {
          "type": "integer",
          "minimum": 6,
          "maximum": 9,
          "default": 7
        },
        "titleCandidateCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5,
          "default": 3
        },
        "coverEnabled": {
          "type": "boolean",
          "default": true
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        }
      }
    }
  },
  "social.xiaohongshu.execute": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "nodeId",
        "expectedRevision"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
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
        }
      }
    }
  },
  "social.xiaohongshu.export": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "nodeId",
        "expectedRevision",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "nodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    }
  },
  "social.douyin.plan": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCanvasRevision",
        "brief"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        },
        "sourceNodeIds": {
          "type": "array",
          "maxItems": 200,
          "uniqueItems": true,
          "default": [],
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          }
        },
        "brief": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "format": {
          "type": "string",
          "enum": [
            "image-to-video",
            "product-showcase",
            "voiceover-assets",
            "knowledge",
            "experience-share"
          ],
          "default": "voiceover-assets"
        },
        "audience": {
          "type": "string",
          "maxLength": 500
        },
        "objective": {
          "type": "string",
          "maxLength": 1000
        },
        "language": {
          "type": "string",
          "maxLength": 80,
          "default": "跟随用户"
        },
        "durationSeconds": {
          "type": "integer",
          "enum": [
            15,
            30,
            60
          ],
          "default": 30
        },
        "shotCount": {
          "type": "integer",
          "minimum": 5,
          "maximum": 8,
          "default": 6
        },
        "subtitlesEnabled": {
          "type": "boolean",
          "default": true
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        }
      }
    }
  },
  "social.douyin.execute": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "nodeId",
        "expectedRevision"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
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
        }
      }
    }
  },
  "social.douyin.status": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "nodeId"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "nodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        }
      }
    }
  },
  "social.douyin.export": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "nodeId",
        "expectedRevision",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "nodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    }
  },
  "research.data.import": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        }
      }
    }
  },
  "research.data.list": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        }
      }
    }
  },
  "research.figure.plan": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCanvasRevision",
        "backend",
        "figureType",
        "researchClaim"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        },
        "sourceNodeIds": {
          "type": "array",
          "maxItems": 200,
          "uniqueItems": true,
          "default": [],
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          }
        },
        "backend": {
          "type": "string",
          "enum": [
            "python",
            "r"
          ]
        },
        "figureType": {
          "type": "string",
          "enum": [
            "statistical-chart",
            "multi-panel",
            "schematic",
            "workflow",
            "image-comparison"
          ]
        },
        "archetype": {
          "type": "string",
          "enum": [
            "quantitative-grid",
            "schematic-led-composite",
            "image-plate-quant",
            "asymmetric-mixed-modality"
          ],
          "default": "quantitative-grid"
        },
        "researchClaim": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "targetJournal": {
          "type": "string",
          "maxLength": 240,
          "default": "Nature 系列"
        },
        "dataSourceIds": {
          "type": "array",
          "maxItems": 12,
          "uniqueItems": true,
          "default": [],
          "items": {
            "type": "string",
            "pattern": "^scientific-data-[a-f0-9]{32}$"
          }
        },
        "panels": {
          "type": "array",
          "minItems": 1,
          "maxItems": 12,
          "items": {
            "type": "object",
            "required": [
              "id",
              "chartType",
              "sourceBindings"
            ],
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80
              },
              "label": {
                "type": "string",
                "maxLength": 12
              },
              "title": {
                "type": "string",
                "maxLength": 240
              },
              "chartType": {
                "type": "string",
                "enum": [
                  "scatter",
                  "line",
                  "bar",
                  "box",
                  "violin",
                  "histogram",
                  "heatmap",
                  "image",
                  "schematic"
                ]
              },
              "sourceBindings": {
                "type": "array",
                "maxItems": 12,
                "uniqueItems": true,
                "items": {
                  "type": "string",
                  "pattern": "^scientific-data-[a-f0-9]{32}$"
                }
              },
              "description": {
                "type": "string",
                "maxLength": 4000
              },
              "xField": {
                "type": "string",
                "maxLength": 160
              },
              "yFields": {
                "type": "array",
                "maxItems": 24,
                "uniqueItems": true,
                "items": {
                  "type": "string",
                  "maxLength": 160
                }
              },
              "groupField": {
                "type": "string",
                "maxLength": 160
              }
            }
          }
        },
        "outputFormats": {
          "type": "array",
          "minItems": 1,
          "maxItems": 4,
          "uniqueItems": true,
          "default": [
            "png",
            "svg",
            "pdf"
          ],
          "items": {
            "type": "string",
            "enum": [
              "png",
              "tiff",
              "svg",
              "pdf"
            ]
          }
        },
        "stylePreset": {
          "type": "string",
          "enum": [
            "nature",
            "nmi-pastel",
            "grayscale"
          ],
          "default": "nature"
        },
        "widthMm": {
          "type": "integer",
          "minimum": 40,
          "maximum": 500,
          "default": 183
        },
        "heightMm": {
          "type": "integer",
          "minimum": 40,
          "maximum": 500,
          "default": 120
        },
        "dpi": {
          "type": "integer",
          "minimum": 150,
          "maximum": 1200,
          "default": 600
        },
        "statisticsNotes": {
          "type": "string",
          "maxLength": 4000
        },
        "sourceDataNotes": {
          "type": "string",
          "maxLength": 4000
        },
        "imageIntegrityNotes": {
          "type": "string",
          "maxLength": 4000
        },
        "reviewerRisks": {
          "type": "array",
          "maxItems": 20,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "maxLength": 4000
          }
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        }
      }
    }
  },
  "research.figure.render": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "expectedCanvasRevision",
        "nodeId",
        "expectedRevision"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedCanvasRevision": {
          "type": "integer",
          "minimum": 0
        },
        "nodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        },
        "timeoutMs": {
          "type": "integer",
          "minimum": 10000,
          "maximum": 300000,
          "default": 120000
        }
      }
    }
  },
  "research.figure.status": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "taskId": {
          "type": "string",
          "pattern": "^scientific-task-[a-f0-9]{32}$"
        },
        "nodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        }
      }
    }
  },
  "research.figure.export": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "taskId",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "taskId": {
          "type": "string",
          "pattern": "^scientific-task-[a-f0-9]{32}$"
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    }
  },
  "research.figure.cancel": {
    "parameters": {
      "type": "object",
      "required": [
        "expectedProjectId",
        "taskId",
        "confirmed"
      ],
      "additionalProperties": false,
      "properties": {
        "expectedProjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "taskId": {
          "type": "string",
          "pattern": "^scientific-task-[a-f0-9]{32}$"
        },
        "confirmed": {
          "type": "boolean"
        }
      }
    },
    "destructive": true
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
        },
        "ratio": {
          "type": "string",
          "enum": [
            "1:1",
            "16:9",
            "9:16",
            "4:3",
            "3:4",
            "3:2",
            "2:3",
            "21:9",
            "9:21",
            "4:5"
          ]
        },
        "resolution": {
          "type": "string",
          "enum": [
            "1K",
            "2K",
            "4K"
          ]
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
        "ratio": {
          "type": "string",
          "enum": [
            "1:1",
            "16:9",
            "9:16",
            "4:3",
            "3:4",
            "3:2",
            "2:3",
            "21:9",
            "9:21",
            "4:5"
          ]
        },
        "resolution": {
          "type": "string",
          "enum": [
            "1K",
            "2K",
            "4K"
          ]
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
            "platformTemplateId": {
              "type": "string",
              "enum": [
                "general",
                "amazon",
                "aliexpress"
              ],
              "default": "general"
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
            "translationItems": {
              "type": "array",
              "maxItems": 200,
              "uniqueItems": true,
              "items": {
                "type": "object",
                "required": [
                  "sourceIndex",
                  "localeCode",
                  "prompt"
                ],
                "additionalProperties": false,
                "properties": {
                  "sourceIndex": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 199
                  },
                  "localeCode": {
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
                    "minLength": 1,
                    "maxLength": 600
                  }
                }
              }
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

export const AUTOMATION_COMMAND_SURFACES = {
  "status": "service",
  "app.state": "renderer",
  "canvas.state": "renderer",
  "debug.runtime-state": "service",
  "debug.renderer-logs": "service",
  "debug.main-logs": "service",
  "debug.run-targeted-test": "service",
  "debug.capture-window": "service",
  "debug.inspect-ipc": "service",
  "debug.inspect-command": "service",
  "workspace.domain.list": "renderer",
  "workspace.domain.get": "renderer",
  "workspace.domain.set": "renderer",
  "project.list": "renderer",
  "project.switch": "renderer",
  "project.create": "renderer",
  "project.rename": "renderer",
  "canvas.select": "renderer",
  "canvas.connect": "renderer",
  "canvas.disconnect": "renderer",
  "canvas.group": "renderer",
  "canvas.dissolve": "renderer",
  "canvas.nudge": "renderer",
  "canvas.create-requirement": "renderer",
  "canvas.update-requirement": "renderer",
  "canvas.execute-requirement": "renderer",
  "canvas.fit": "renderer",
  "canvas.clear": "renderer",
  "canvas.delete-selected": "renderer",
  "canvas.create-container": "renderer",
  "canvas.import": "renderer",
  "canvas.import-video": "renderer",
  "canvas.generate-video": "renderer",
  "canvas.import-skill": "renderer",
  "canvas.rename-image-collections": "renderer",
  "canvas.replace-image-collection-item": "renderer",
  "canvas.export-image-collections": "renderer",
  "canvas.export-image": "renderer",
  "requirement-library.list": "renderer",
  "requirement-library.save": "renderer",
  "requirement-library.delete": "renderer",
  "requirement-library.use": "renderer",
  "commerce.template.list": "renderer",
  "commerce.template.save": "renderer",
  "commerce.template.delete": "renderer",
  "commerce.template.import": "renderer",
  "commerce.template.export": "renderer",
  "commerce.catalog.list": "renderer",
  "commerce.catalog.upsert": "renderer",
  "commerce.catalog.delete": "renderer",
  "commerce.catalog.assign": "renderer",
  "commerce.catalog.remove": "renderer",
  "commerce.catalog.review": "renderer",
  "commerce.catalog.compare": "renderer",
  "commerce.catalog.select": "renderer",
  "commerce.export.preview": "renderer",
  "commerce.export.package": "renderer",
  "social.xiaohongshu.plan": "renderer",
  "social.xiaohongshu.execute": "renderer",
  "social.xiaohongshu.export": "renderer",
  "social.douyin.plan": "renderer",
  "social.douyin.execute": "renderer",
  "social.douyin.status": "renderer",
  "social.douyin.export": "renderer",
  "research.data.import": "renderer",
  "research.data.list": "renderer",
  "research.figure.plan": "renderer",
  "research.figure.render": "renderer",
  "research.figure.status": "renderer",
  "research.figure.export": "renderer",
  "research.figure.cancel": "renderer",
  "agent.chat": "renderer",
  "agent.goal": "renderer",
  "commerce.compose-set": "renderer",
  "agent.steer": "renderer",
  "agent.pause": "renderer",
  "agent.resume": "renderer",
  "agent.stop": "renderer",
  "agent.new-conversation": "renderer"
} as const;

export const AUTOMATION_COMMAND_ENUMS = {
  "debug.run-targeted-test": {
    "testName": [
      "typecheck",
      "test:automation-debug",
      "test:mcp-wrapper",
      "test:ipc-registration",
      "test:workspace-domain",
      "test:automation-service",
      "test:scientific-runner",
      "test:commerce-template"
    ]
  },
  "debug.capture-window": {
    "scope": [
      "page",
      "window"
    ]
  },
  "workspace.domain.set": {
    "domain": [
      "general",
      "commerce",
      "social",
      "research"
    ]
  },
  "project.create": {
    "workspaceDomain": [
      "general",
      "commerce",
      "social",
      "research"
    ]
  },
  "canvas.generate-video": {
    "aspectRatio": [
      "16:9",
      "9:16",
      "1:1",
      "4:3",
      "3:4"
    ],
    "resolution": [
      "480p",
      "720p",
      "1080p"
    ]
  },
  "canvas.export-image-collections": {
    "format": [
      "png",
      "jpeg",
      "webp",
      "avif",
      "tiff"
    ]
  },
  "canvas.export-image": {
    "format": [
      "png",
      "jpeg",
      "webp",
      "avif",
      "tiff"
    ]
  },
  "commerce.template.save": {
    "conflictPolicy": [
      "overwrite",
      "copy"
    ]
  },
  "commerce.catalog.assign": {
    "kind": [
      "master",
      "brand",
      "result"
    ],
    "ownerType": [
      "product",
      "variant",
      "sku"
    ]
  },
  "commerce.catalog.review": {
    "state": [
      "candidate",
      "approved",
      "rejected"
    ]
  },
  "commerce.export.preview": {
    "platform": [
      "amazon",
      "aliexpress"
    ],
    "format": [
      "jpeg",
      "png"
    ]
  },
  "commerce.export.package": {
    "platform": [
      "amazon",
      "aliexpress"
    ],
    "format": [
      "jpeg",
      "png"
    ]
  },
  "social.xiaohongshu.plan": {
    "contentKind": [
      "product-seeding",
      "tutorial",
      "comparison",
      "knowledge",
      "list",
      "experience-share",
      "travel"
    ],
    "ratio": [
      "3:4",
      "4:5",
      "1:1"
    ]
  },
  "social.douyin.plan": {
    "format": [
      "image-to-video",
      "product-showcase",
      "voiceover-assets",
      "knowledge",
      "experience-share"
    ],
    "durationSeconds": [
      15,
      30,
      60
    ]
  },
  "research.figure.plan": {
    "backend": [
      "python",
      "r"
    ],
    "figureType": [
      "statistical-chart",
      "multi-panel",
      "schematic",
      "workflow",
      "image-comparison"
    ],
    "archetype": [
      "quantitative-grid",
      "schematic-led-composite",
      "image-plate-quant",
      "asymmetric-mixed-modality"
    ],
    "stylePreset": [
      "nature",
      "nmi-pastel",
      "grayscale"
    ]
  },
  "agent.chat": {
    "ratio": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
      "9:21",
      "4:5"
    ],
    "resolution": [
      "1K",
      "2K",
      "4K"
    ]
  },
  "agent.goal": {
    "ratio": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
      "9:21",
      "4:5"
    ],
    "resolution": [
      "1K",
      "2K",
      "4K"
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

export type AutomationServiceCommandName = typeof AUTOMATION_SERVICE_COMMAND_NAMES[number];

const automationRendererCommandNames = new Set<string>(AUTOMATION_RENDERER_COMMAND_NAMES);

const automationServiceCommandNames = new Set<string>(AUTOMATION_SERVICE_COMMAND_NAMES);

export function isAutomationRendererCommandName(value: string): value is AutomationRendererCommandName {
  return automationRendererCommandNames.has(value);
}

export function isAutomationServiceCommandName(value: string): value is AutomationServiceCommandName {
  return automationServiceCommandNames.has(value);
}
