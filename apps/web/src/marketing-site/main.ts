import { bootstrapApplication } from '@angular/platform-browser';

import { appConfig } from './app.config';
import { MarketingSiteComponent } from './marketing-site.component';

bootstrapApplication(MarketingSiteComponent, appConfig).catch((err) => console.error(err));
