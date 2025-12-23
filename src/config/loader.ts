/**
 * YAML configuration loader with type-safe parsing
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import * as yaml from 'js-yaml'
import { validateConfig, validateConfigSafe, type LoomConfig } from './schema'

/**
 * Load and validate config from YAML file
 * @throws Error if file doesn't exist or validation fails
 */
export function loadConfig(filePath: string): LoomConfig {
  const absolutePath = resolve(filePath)
  
  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`)
  }
  
  try {
    const fileContent = readFileSync(absolutePath, 'utf-8')
    const rawConfig = yaml.load(fileContent)
    
    // Validate with Zod
    return validateConfig(rawConfig)
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${filePath}: ${error.message}`)
    }
    throw error
  }
}

/**
 * Load config with detailed error reporting
 * Returns success/failure with error messages
 */
export function loadConfigSafe(filePath: string): { success: true; data: LoomConfig } | { success: false; errors: string[] } {
  const absolutePath = resolve(filePath)
  
  if (!existsSync(absolutePath)) {
    return { 
      success: false, 
      errors: [`Config file not found: ${absolutePath}`] 
    }
  }
  
  try {
    const fileContent = readFileSync(absolutePath, 'utf-8')
    const rawConfig = yaml.load(fileContent)
    
    return validateConfigSafe(rawConfig)
  } catch (error) {
    if (error instanceof Error) {
      return { 
        success: false, 
        errors: [`Failed to parse YAML: ${error.message}`] 
      }
    }
    return { 
      success: false, 
      errors: ['Unknown error loading config'] 
    }
  }
}

/**
 * Try to load config from default locations
 * Returns first found config or undefined
 */
export function loadConfigFromDefaults(): LoomConfig | undefined {
  const defaultPaths = [
    'loom.config.yaml',
    'loom.config.yml',
    '.loom.yaml',
    '.loom.yml',
    'config/loom.yaml',
    'config/loom.yml',
  ]
  
  for (const path of defaultPaths) {
    if (existsSync(path)) {
      try {
        return loadConfig(path)
      } catch (error) {
        // Continue to next path
        console.warn(`Failed to load ${path}:`, error)
      }
    }
  }
  
  return undefined
}

/**
 * Load config from environment variable or default paths
 */
export function loadConfigAuto(): LoomConfig | undefined {
  // Check environment variable first
  const configPath = process.env.LOOM_CONFIG_PATH
  
  if (configPath) {
    return loadConfig(configPath)
  }
  
  // Try default locations
  return loadConfigFromDefaults()
}
