import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';

import { config } from './app.config.server';
import { MarketingSiteComponent } from './marketing-site.component';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(MarketingSiteComponent, config, context);

export default bootstrap;
