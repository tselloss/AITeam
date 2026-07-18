.PHONY: all install test start clean build-plugin

all: install test

install:
	npm install

test:
	node --test

start:
	npm start

build-plugin:
	npm run build:plugin

clean:
	rm -rf node_modules app/workspaces
