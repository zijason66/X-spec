#!/usr/bin/env node

import { program } from 'commander';
import { initCommand } from './commands/init.js';
import { initTemplateCommand } from './commands/init-template.js';
import { knowledgeCommand } from './commands/knowledge.js';
import { modeCommand } from './commands/mode.js';
import { proposeCommand } from './commands/propose.js';
import { reviewCommand } from './commands/review.js';
import { spCommand } from './commands/sp.js';
import { applyCommand } from './commands/apply.js';
import { archiveCommand } from './commands/archive.js';
import { verifyCommand } from './commands/verify.js';
import { workflowCommand } from './commands/workflow.js';
import { templateCommand } from './commands/template.js';
import { runCommand } from './commands/run.js';

program
  .name('x-spec')
  .description('SDD规范驱动开发框架 - 集成OpenSpec与SuperPowers')
  .version('1.0.0');

program.addCommand(initCommand);
program.addCommand(initTemplateCommand);
program.addCommand(knowledgeCommand);
program.addCommand(modeCommand);
program.addCommand(proposeCommand);
program.addCommand(reviewCommand);
program.addCommand(spCommand);
program.addCommand(applyCommand);
program.addCommand(archiveCommand);
program.addCommand(verifyCommand);
program.addCommand(workflowCommand);
program.addCommand(templateCommand);
program.addCommand(runCommand);

program.parse();
