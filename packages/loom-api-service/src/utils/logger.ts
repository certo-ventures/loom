/**
 * Logger Utility
 */

import winston from 'winston'
import { config } from '../config'

const format = config.logging.format === 'json' 
  ? winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  : winston.format.combine(
      winston.format.timestamp(),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : ''
        return `${timestamp} ${level}: ${message} ${metaStr}`
      })
    )

export const logger = winston.createLogger({
  level: config.logging.level,
  format,
  transports: [
    new winston.transports.Console()
  ]
})
