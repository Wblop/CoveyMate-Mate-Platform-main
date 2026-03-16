import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';

import { AppSiteComponent } from './app-site.component';
import { config } from './app.config.server';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(AppSiteComponent, config, context);

export default bootstrap;
