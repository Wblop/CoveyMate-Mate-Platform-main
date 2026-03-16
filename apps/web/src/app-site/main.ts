import { bootstrapApplication } from '@angular/platform-browser';

import { AppSiteComponent } from './app-site.component';
import { appConfig } from './app.config';

bootstrapApplication(AppSiteComponent, appConfig).catch((err) => console.error(err));
