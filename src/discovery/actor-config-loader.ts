/**
 * Actor Configuration Loader
 * 
 * Loads actor metadata from YAML or JSON config files.
 * Supports environment variable substitution and validation.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import type { ActorMetadata } from './actor-metadata'
import { validateActorMetadata } from './actor-metadata'

/**
 * Actor config file structure
 */
export interface ActorConfigFile {
  version: string
  actors: ActorMetadata[]
}

/**
 * Config loader options
 */
export interface ConfigLoaderOptions {
  /** Config file path (YAML or JSON) */
  configPath?: string
  
  /** Directory to scan for actor configs */
  configDir?: string
  
  /** Enable environment variable substitution */
  envSubstitution?: boolean
  
  /** Validate metadata against schema */
  validate?: boolean
  
  /** Fail on validation errors */
  strict?: boolean
}

/**
 * Load result with diagnostics
 */
export interface LoadResult {
  actors: ActorMetadata[]
  errors: { actorName: string; errors: string[] }[]
  warnings: string[]
}

/**
 * Actor Config Loader
 */
export class ActorConfigLoader {
  constructor(private options: ConfigLoaderOptions = {}) {
    // Defaults
    this.options.envSubstitution = options.envSubstitution ?? true
    this.options.validate = options.validate ?? true
    this.options.strict = options.strict ?? false
  }

  /**
   * Load actors from config file
   */
  async load(): Promise<LoadResult> {
    const result: LoadResult = {
      actors: [],
      errors: [],
      warnings: []
    }

    try {
      if (this.options.configPath) {
        // Load single config file
        const config = await this.loadConfigFile(this.options.configPath)
        this.processConfig(config, result)
      } else if (this.options.configDir) {
        // Load all config files in directory
        const configs = await this.loadConfigDir(this.options.configDir)
        for (const config of configs) {
          this.processConfig(config, result)
        }
      } else {
        // Try default locations
        const defaultPaths = [
          'actors.config.yaml',
          'actors.config.yml',
          'actors.config.json',
          'config/actors.yaml',
          'config/actors.yml',
          'config/actors.json'
        ]

        for (const defaultPath of defaultPaths) {
          try {
            const config = await this.loadConfigFile(defaultPath)
            this.processConfig(config, result)
            break // Use first found config
          } catch (err) {
            // Try next path
            continue
          }
        }

        if (result.actors.length === 0) {
          result.warnings.push(
            'No actor config found. Tried: ' + defaultPaths.join(', ')
          )
        }
      }
    } catch (err) {
      result.warnings.push(`Failed to load config: ${err instanceof Error ? err.message : String(err)}`)
    }

    return result
  }

  /**
   * Load single config file
   */
  private async loadConfigFile(filePath: string): Promise<ActorConfigFile> {
    const content = await fs.readFile(filePath, 'utf-8')
    
    const ext = path.extname(filePath).toLowerCase()
    let config: ActorConfigFile

    if (ext === '.yaml' || ext === '.yml') {
      config = yaml.load(content) as ActorConfigFile
    } else if (ext === '.json') {
      config = JSON.parse(content)
    } else {
      throw new Error(`Unsupported config format: ${ext}`)
    }

    // Validate config structure
    if (!config.version) {
      throw new Error('Config missing version field')
    }
    if (!Array.isArray(config.actors)) {
      throw new Error('Config missing actors array')
    }

    return config
  }

  /**
   * Load all config files in directory
   */
  private async loadConfigDir(dirPath: string): Promise<ActorConfigFile[]> {
    const configs: ActorConfigFile[] = []
    
    try {
      const files = await fs.readdir(dirPath)
      
      for (const file of files) {
        const ext = path.extname(file).toLowerCase()
        if (['.yaml', '.yml', '.json'].includes(ext)) {
          try {
            const config = await this.loadConfigFile(path.join(dirPath, file))
            configs.push(config)
          } catch (err) {
            // Log but continue with other files
            console.warn(`Failed to load ${file}:`, err)
          }
        }
      }
    } catch (err) {
      throw new Error(`Failed to read config directory: ${dirPath}`)
    }

    return configs
  }

  /**
   * Process loaded config
   */
  private processConfig(config: ActorConfigFile, result: LoadResult): void {
    for (const actorMetadata of config.actors) {
      // Environment variable substitution
      if (this.options.envSubstitution) {
        this.substituteEnvVars(actorMetadata)
      }

      // Validation
      if (this.options.validate) {
        const validation = validateActorMetadata(actorMetadata)
        if (!validation.valid) {
          result.errors.push({
            actorName: actorMetadata.name || 'unknown',
            errors: validation.errors
          })

          if (this.options.strict) {
            continue // Skip invalid actors in strict mode
          }
        }
      }

      result.actors.push(actorMetadata)
    }
  }

  /**
   * Substitute environment variables in strings
   * Supports: ${VAR_NAME} and ${VAR_NAME:-default}
   */
  private substituteEnvVars(obj: any): void {
    if (typeof obj === 'string') {
      return
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (typeof obj[i] === 'string') {
          obj[i] = this.replaceEnvVars(obj[i])
        } else if (typeof obj[i] === 'object' && obj[i] !== null) {
          this.substituteEnvVars(obj[i])
        }
      }
      return
    }

    if (typeof obj === 'object' && obj !== null) {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          obj[key] = this.replaceEnvVars(obj[key])
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          this.substituteEnvVars(obj[key])
        }
      }
    }
  }

  /**
   * Replace environment variables in a string
   */
  private replaceEnvVars(str: string): string {
    return str.replace(/\$\{([^}:]+)(:-([^}]+))?\}/g, (match, varName, _, defaultValue) => {
      const value = process.env[varName]
      if (value !== undefined) {
        return value
      }
      if (defaultValue !== undefined) {
        return defaultValue
      }
      return match // Leave unchanged if no env var or default
    })
  }

  /**
   * Save actors to config file
   */
  async save(actors: ActorMetadata[], filePath: string): Promise<void> {
    const config: ActorConfigFile = {
      version: '1.0',
      actors
    }

    const ext = path.extname(filePath).toLowerCase()
    let content: string

    if (ext === '.yaml' || ext === '.yml') {
      content = yaml.dump(config, { indent: 2 })
    } else if (ext === '.json') {
      content = JSON.stringify(config, null, 2)
    } else {
      throw new Error(`Unsupported config format: ${ext}`)
    }

    await fs.writeFile(filePath, content, 'utf-8')
  }
}

/**
 * Convenience function to load actor config
 */
export async function loadActorConfig(
  options?: ConfigLoaderOptions
): Promise<LoadResult> {
  const loader = new ActorConfigLoader(options)
  return loader.load()
}

/**
 * Convenience function to save actor config
 */
export async function saveActorConfig(
  actors: ActorMetadata[],
  filePath: string
): Promise<void> {
  const loader = new ActorConfigLoader()
  return loader.save(actors, filePath)
}
