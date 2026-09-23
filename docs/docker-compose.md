# docker

The package can also be installed using docker compose.

The reference to the repository is: **ghcr.io/mygitmosi/todoist-enhancements:latest**

Here is an example of installing the actual version into docker. 
**docker-compose.yaml**:
```
services:
	enhancements-for-todoist:
		image: ghcr.io/mygitmosi/todoist-enhancements:latest
		container_name: enhancements_for_todoist
		ports:
			- "8080:80"
		restart: unless-stopped
```
